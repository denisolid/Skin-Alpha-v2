import {
  IngestionFailureClass,
  IngestionJobStatus,
  IngestionPriorityClass,
  SyncType,
  type Prisma,
} from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { AppLoggerService } from '../../../infrastructure/logging/app-logger.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { canonicalizeJsonPayload } from '../infrastructure/utils/json-payload.util';
import type { SourceAdapterKey } from '../domain/source-adapter.types';
import { SourceRecordService } from './source-record.service';
import { SourceFailureClassifierService } from './source-failure-classifier.service';

interface EnsureQueuedFetchJobInput {
  readonly source: SourceAdapterKey;
  readonly queueName: string;
  readonly jobName: string;
  readonly jobRunId: string;
  readonly externalJobId?: string;
  readonly payload?: Prisma.InputJsonValue;
}

interface MarkRunningFetchJobInput extends EnsureQueuedFetchJobInput {}

interface CompleteFetchJobInput {
  readonly jobRunId: string;
  readonly result?: Prisma.InputJsonValue;
}

interface FailFetchJobInput extends CompleteFetchJobInput {
  readonly errorMessage: string;
}

@Injectable()
export class SourceFetchJobService {
  constructor(
    @Inject(AppLoggerService)
    private readonly logger: AppLoggerService,
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(SourceRecordService)
    private readonly sourceRecordService: SourceRecordService,
    @Inject(SourceFailureClassifierService)
    private readonly sourceFailureClassifierService: SourceFailureClassifierService,
  ) {}

  async ensureQueuedFetchJob(
    input: EnsureQueuedFetchJobInput,
  ): Promise<string> {
    const source = await this.sourceRecordService.resolveByKey(input.source);
    const requestFingerprint = this.buildRequestFingerprint(input.payload);
    const idempotencyKey =
      input.externalJobId ??
      `${input.queueName}:${input.jobName}:${requestFingerprint ?? input.jobRunId}`;
    const metadata = this.buildMetadata(input.payload);
    const trigger = this.resolveTrigger(input.payload);
    const mode = this.resolveMode(input.payload);
    const segmentKey = this.resolveSegmentKey(input.payload);
    const fetchJob = await this.prismaService.sourceFetchJob.upsert({
      where: {
        sourceId_idempotencyKey: {
          sourceId: source.id,
          idempotencyKey,
        },
      },
      create: {
        sourceId: source.id,
        syncType: this.resolveSyncType(input.queueName, input.jobName),
        queueName: input.queueName,
        jobName: input.jobName,
        ...(input.externalJobId ? { externalJobId: input.externalJobId } : {}),
        idempotencyKey,
        status: IngestionJobStatus.QUEUED,
        priorityClass: this.resolvePriorityClass(input.payload),
        ...(trigger ? { trigger } : {}),
        ...(mode ? { mode } : {}),
        ...(segmentKey ? { segmentKey } : {}),
        ...(requestFingerprint ? { requestFingerprint } : {}),
        ...(metadata ? { metadata } : {}),
      },
      update: {
        status: IngestionJobStatus.QUEUED,
        ...(input.externalJobId ? { externalJobId: input.externalJobId } : {}),
        priorityClass: this.resolvePriorityClass(input.payload),
        ...(trigger ? { trigger } : {}),
        ...(mode ? { mode } : {}),
        ...(segmentKey ? { segmentKey } : {}),
        ...(requestFingerprint ? { requestFingerprint } : {}),
        ...(metadata ? { metadata } : {}),
      },
      select: {
        id: true,
      },
    });

    await this.prismaService.jobRun.update({
      where: {
        id: input.jobRunId,
      },
      data: {
        fetchJobId: fetchJob.id,
      },
    });

    return fetchJob.id;
  }

  async markRunning(input: MarkRunningFetchJobInput): Promise<string> {
    const fetchJobId = await this.ensureQueuedFetchJob(input);
    const now = new Date();

    await this.prismaService.sourceFetchJob.update({
      where: {
        id: fetchJobId,
      },
      data: {
        status: IngestionJobStatus.RUNNING,
        startedAt: now,
        lastHeartbeatAt: now,
        leaseUntil: new Date(now.getTime() + 15 * 60 * 1000),
        attempt: {
          increment: 1,
        },
      },
    });

    return fetchJobId;
  }

  async markSucceeded(input: CompleteFetchJobInput): Promise<void> {
    const fetchJob = await this.findByJobRunId(input.jobRunId);

    if (!fetchJob) {
      return;
    }

    const responseStatus = this.extractHttpStatus(input.result);
    await this.prismaService.sourceFetchJob.update({
      where: {
        id: fetchJob.id,
      },
      data: {
        status: IngestionJobStatus.SUCCEEDED,
        finishedAt: new Date(),
        lastHeartbeatAt: new Date(),
        ...(responseStatus !== undefined ? { responseStatus } : {}),
      },
    });
  }

  async markCanceled(input: CompleteFetchJobInput): Promise<void> {
    const fetchJob = await this.findByJobRunId(input.jobRunId);

    if (!fetchJob) {
      return;
    }

    await this.prismaService.sourceFetchJob.update({
      where: {
        id: fetchJob.id,
      },
      data: {
        status: IngestionJobStatus.CANCELED,
        finishedAt: new Date(),
        lastHeartbeatAt: new Date(),
      },
    });
  }

  async markFailed(input: FailFetchJobInput): Promise<void> {
    const fetchJob = await this.findByJobRunId(input.jobRunId);

    if (!fetchJob) {
      return;
    }

    const failureClass = this.sourceFailureClassifierService.classifyMessage(
      input.errorMessage,
    );

    await this.prismaService.sourceFetchJob.update({
      where: {
        id: fetchJob.id,
      },
      data: {
        status: IngestionJobStatus.FAILED,
        finishedAt: new Date(),
        lastHeartbeatAt: new Date(),
        failureClass,
        failureMessage: input.errorMessage,
      },
    });
  }

  async linkRawPayloadArchive(
    rawPayloadArchiveId: string,
    fetchJobId: string | undefined,
  ): Promise<void> {
    if (!fetchJobId) {
      return;
    }

    await this.prismaService.sourceFetchJob.update({
      where: {
        id: fetchJobId,
      },
      data: {
        rawPayloadCount: {
          increment: 1,
        },
        lastHeartbeatAt: new Date(),
      },
    });

    this.logger.debug(
      `Linked raw payload archive ${rawPayloadArchiveId} to fetch job ${fetchJobId}.`,
      SourceFetchJobService.name,
    );
  }

  async recordNormalization(
    fetchJobId: string | undefined,
    normalizedCount: number,
    warningCount: number,
  ): Promise<void> {
    if (!fetchJobId) {
      return;
    }

    await this.prismaService.sourceFetchJob.update({
      where: {
        id: fetchJobId,
      },
      data: {
        normalizedCount: {
          increment: Math.max(0, normalizedCount),
        },
        warningCount: {
          increment: Math.max(0, warningCount),
        },
        lastHeartbeatAt: new Date(),
      },
    });
  }

  private async findByJobRunId(jobRunId: string): Promise<{
    readonly id: string;
  } | null> {
    const jobRun = await this.prismaService.jobRun.findUnique({
      where: {
        id: jobRunId,
      },
      select: {
        fetchJobId: true,
      },
    });

    if (!jobRun?.fetchJobId) {
      return null;
    }

    return {
      id: jobRun.fetchJobId,
    };
  }

  private resolveSyncType(queueName: string, jobName: string): SyncType {
    const normalizedName = `${queueName}:${jobName}`.toLowerCase();

    if (normalizedName.includes('health')) {
      return SyncType.HEALTH;
    }

    if (
      normalizedName.includes('snapshot') ||
      normalizedName.includes('market-state') ||
      normalizedName.includes('sales-history')
    ) {
      return SyncType.MARKET_STATE;
    }

    return SyncType.LISTINGS;
  }

  private resolvePriorityClass(
    payload: Prisma.InputJsonValue | undefined,
  ): IngestionPriorityClass {
    const record = this.asRecord(payload);
    const trigger = this.asString(record?.trigger);

    if (trigger === 'recovery') {
      return IngestionPriorityClass.RECOVERY;
    }

    if (trigger === 'bootstrap') {
      return IngestionPriorityClass.BACKFILL;
    }

    if (
      Array.isArray(record?.targetItemVariantIds) &&
      record.targetItemVariantIds.length > 0
    ) {
      return IngestionPriorityClass.HOT;
    }

    if (record?.force === true) {
      return IngestionPriorityClass.WARM;
    }

    return IngestionPriorityClass.WARM;
  }

  private resolveTrigger(payload: Prisma.InputJsonValue | undefined) {
    return this.asString(this.asRecord(payload)?.trigger);
  }

  private resolveMode(payload: Prisma.InputJsonValue | undefined) {
    return this.asString(this.asRecord(payload)?.mode);
  }

  private resolveSegmentKey(payload: Prisma.InputJsonValue | undefined) {
    const record = this.asRecord(payload);
    const filters = this.asRecord(record?.filters);

    return (
      this.asString(filters?.marketHashName) ??
      this.asString(record?.event) ??
      this.asString(record?.batchId)
    );
  }

  private buildRequestFingerprint(
    payload: Prisma.InputJsonValue | undefined,
  ): string | undefined {
    if (!payload) {
      return undefined;
    }

    return canonicalizeJsonPayload(payload).hash;
  }

  private buildMetadata(
    payload: Prisma.InputJsonValue | undefined,
  ): Prisma.InputJsonValue | undefined {
    if (!payload) {
      return undefined;
    }

    return JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue;
  }

  private extractHttpStatus(
    result: Prisma.InputJsonValue | undefined,
  ): number | undefined {
    const value = this.asRecord(result)?.httpStatus;

    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined;
  }

  private asRecord(
    value: Prisma.InputJsonValue | null | undefined,
  ): Prisma.InputJsonObject | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    return value as Prisma.InputJsonObject;
  }

  private asString(
    value: Prisma.InputJsonValue | null | undefined,
  ): string | undefined {
    return typeof value === 'string' && value.trim().length > 0
      ? value
      : undefined;
  }
}
