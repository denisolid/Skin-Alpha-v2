import {
  HealthStatus,
  JobRunStatus,
  JobType,
  SyncStatus,
  type Prisma,
  type SourceSyncStatus,
  type SyncType,
} from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { AppLoggerService } from '../../../infrastructure/logging/app-logger.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { SourceAdapterKey } from '../domain/source-adapter.types';
import type { SourceHealthModel } from '../domain/source-health.model';
import { SourceRecordService } from './source-record.service';

interface StartJobRunInput {
  readonly source: SourceAdapterKey;
  readonly queueName: string;
  readonly jobName: string;
  readonly externalJobId?: string;
  readonly payload?: Prisma.InputJsonValue;
}

interface CompleteJobRunInput {
  readonly jobRunId: string;
  readonly result?: Prisma.InputJsonValue;
}

interface FailJobRunInput {
  readonly jobRunId: string;
  readonly errorMessage: string;
  readonly result?: Prisma.InputJsonValue;
}

interface UpsertSyncStatusInput {
  readonly source: SourceAdapterKey;
  readonly syncType: SyncType;
  readonly status: SyncStatus;
  readonly jobRunId?: string;
  readonly details?: Prisma.InputJsonValue;
  readonly cursor?: Prisma.InputJsonValue;
  readonly markSuccessful?: boolean;
  readonly markFailed?: boolean;
}

interface RecordHealthMetricInput {
  readonly source: SourceAdapterKey;
  readonly status: HealthStatus;
  readonly availabilityRatio?: number;
  readonly errorRate?: number;
  readonly latencyMs?: number;
  readonly rateLimitRemaining?: number;
  readonly queueDepth?: number;
  readonly details?: Prisma.InputJsonValue;
}

interface StartQueuedJobRunInput extends StartJobRunInput {
  readonly externalJobId: string;
}

@Injectable()
export class SourceOperationsService {
  constructor(
    @Inject(AppLoggerService)
    private readonly logger: AppLoggerService,
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(SourceRecordService)
    private readonly sourceRecordService: SourceRecordService,
  ) {}

  async startJobRun(input: StartJobRunInput): Promise<string> {
    const source = await this.sourceRecordService.resolveByKey(input.source);
    const createData: Prisma.JobRunUncheckedCreateInput = {
      sourceId: source.id,
      queueName: input.queueName,
      jobType: JobType.SYNC,
      jobName: input.jobName,
      ...(input.externalJobId ? { externalJobId: input.externalJobId } : {}),
      status: JobRunStatus.RUNNING,
      startedAt: new Date(),
      ...(input.payload ? { payload: input.payload } : {}),
    };
    const jobRun = await this.prismaService.jobRun.create({
      data: createData,
    });
    this.logger.log(
      `Started job run ${jobRun.id} for ${input.source}:${input.queueName}.`,
      SourceOperationsService.name,
    );

    return jobRun.id;
  }

  async ensureQueuedJobRun(input: StartJobRunInput): Promise<string> {
    const source = await this.sourceRecordService.resolveByKey(input.source);

    if (input.externalJobId) {
      const existingJobRun = await this.prismaService.jobRun.findFirst({
        where: {
          sourceId: source.id,
          queueName: input.queueName,
          jobName: input.jobName,
          externalJobId: input.externalJobId,
          finishedAt: null,
        },
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          id: true,
        },
      });

      if (existingJobRun) {
        this.logger.debug(
          `Reused queued job run ${existingJobRun.id} for ${input.source}:${input.queueName}.`,
          SourceOperationsService.name,
        );
        return existingJobRun.id;
      }
    }

    const createData: Prisma.JobRunUncheckedCreateInput = {
      sourceId: source.id,
      queueName: input.queueName,
      jobType: JobType.SYNC,
      jobName: input.jobName,
      status: JobRunStatus.QUEUED,
      ...(input.externalJobId ? { externalJobId: input.externalJobId } : {}),
      ...(input.payload ? { payload: input.payload } : {}),
    };
    const jobRun = await this.prismaService.jobRun.create({
      data: createData,
    });
    this.logger.log(
      `Queued job run ${jobRun.id} for ${input.source}:${input.queueName}${input.externalJobId ? ` (${input.externalJobId})` : ''}.`,
      SourceOperationsService.name,
    );

    return jobRun.id;
  }

  async startQueuedJobRun(input: StartQueuedJobRunInput): Promise<string> {
    const source = await this.sourceRecordService.resolveByKey(input.source);
    const existingJobRun = await this.prismaService.jobRun.findFirst({
      where: {
        sourceId: source.id,
        queueName: input.queueName,
        jobName: input.jobName,
        externalJobId: input.externalJobId,
        finishedAt: null,
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!existingJobRun) {
      return this.startJobRun(input);
    }

    if (existingJobRun.status !== JobRunStatus.RUNNING) {
      await this.prismaService.jobRun.update({
        where: {
          id: existingJobRun.id,
        },
        data: {
          status: JobRunStatus.RUNNING,
          startedAt: new Date(),
          ...(input.payload ? { payload: input.payload } : {}),
        },
      });
      this.logger.log(
        `Promoted queued job run ${existingJobRun.id} to RUNNING for ${input.source}:${input.queueName}.`,
        SourceOperationsService.name,
      );
    }

    return existingJobRun.id;
  }

  async completeJobRun(input: CompleteJobRunInput): Promise<void> {
    await this.prismaService.jobRun.update({
      where: {
        id: input.jobRunId,
      },
      data: {
        status: JobRunStatus.SUCCEEDED,
        finishedAt: new Date(),
        ...(input.result ? { result: input.result } : {}),
      },
    });
    this.logger.log(
      `Completed job run ${input.jobRunId}.`,
      SourceOperationsService.name,
    );
  }

  async cancelJobRun(input: CompleteJobRunInput): Promise<void> {
    await this.prismaService.jobRun.update({
      where: {
        id: input.jobRunId,
      },
      data: {
        status: JobRunStatus.CANCELED,
        finishedAt: new Date(),
        ...(input.result ? { result: input.result } : {}),
      },
    });
    this.logger.warn(
      `Canceled job run ${input.jobRunId}.`,
      SourceOperationsService.name,
    );
  }

  async failJobRun(input: FailJobRunInput): Promise<void> {
    await this.prismaService.jobRun.update({
      where: {
        id: input.jobRunId,
      },
      data: {
        status: JobRunStatus.FAILED,
        errorMessage: input.errorMessage,
        finishedAt: new Date(),
        ...(input.result ? { result: input.result } : {}),
      },
    });
    this.logger.error(
      `Failed job run ${input.jobRunId}: ${input.errorMessage}`,
      undefined,
      SourceOperationsService.name,
    );
  }

  async upsertSyncStatus(input: UpsertSyncStatusInput): Promise<void> {
    const source = await this.sourceRecordService.resolveByKey(input.source);
    const now = new Date();
    const currentStatus = await this.getLatestSyncStatus(
      input.source,
      input.syncType,
    );

    const consecutiveFailureCount = input.markFailed
      ? (currentStatus?.consecutiveFailureCount ?? 0) + 1
      : input.markSuccessful
        ? 0
        : (currentStatus?.consecutiveFailureCount ?? 0);
    const createData: Prisma.SourceSyncStatusUncheckedCreateInput = {
      sourceId: source.id,
      syncType: input.syncType,
      status: input.status,
      consecutiveFailureCount,
      ...(input.status === SyncStatus.RUNNING ? { startedAt: now } : {}),
      ...(input.status !== SyncStatus.RUNNING ? { completedAt: now } : {}),
      ...(input.markSuccessful ? { lastSuccessfulAt: now } : {}),
      ...(input.markFailed ? { lastFailureAt: now } : {}),
      ...(input.jobRunId ? { lastJobRunId: input.jobRunId } : {}),
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(input.details ? { details: input.details } : {}),
    };
    const updateData: Prisma.SourceSyncStatusUncheckedUpdateInput = {
      status: input.status,
      consecutiveFailureCount,
      ...(input.status === SyncStatus.RUNNING ? { startedAt: now } : {}),
      ...(input.status !== SyncStatus.RUNNING ? { completedAt: now } : {}),
      ...(input.markSuccessful ? { lastSuccessfulAt: now } : {}),
      ...(input.markFailed ? { lastFailureAt: now } : {}),
      ...(input.jobRunId ? { lastJobRunId: input.jobRunId } : {}),
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(input.details ? { details: input.details } : {}),
    };

    await this.prismaService.sourceSyncStatus.upsert({
      where: {
        sourceId_syncType: {
          sourceId: source.id,
          syncType: input.syncType,
        },
      },
      create: createData,
      update: updateData,
    });
  }

  async recordHealthMetric(input: RecordHealthMetricInput): Promise<void> {
    const source = await this.sourceRecordService.resolveByKey(input.source);

    await this.prismaService.sourceHealthMetric.create({
      data: {
        sourceId: source.id,
        status: input.status,
        ...(input.availabilityRatio !== undefined
          ? { availabilityRatio: input.availabilityRatio.toFixed(4) }
          : {}),
        ...(input.errorRate !== undefined
          ? { errorRate: input.errorRate.toFixed(4) }
          : {}),
        ...(input.latencyMs !== undefined
          ? {
              latencyP50Ms: input.latencyMs,
              latencyP95Ms: input.latencyMs,
              latencyP99Ms: input.latencyMs,
            }
          : {}),
        ...(input.rateLimitRemaining !== undefined
          ? { rateLimitRemaining: input.rateLimitRemaining }
          : {}),
        ...(input.queueDepth !== undefined
          ? { queueDepth: input.queueDepth }
          : {}),
        ...(input.details ? { details: input.details } : {}),
      },
    });
  }

  async getSourceHealth(source: SourceAdapterKey): Promise<SourceHealthModel> {
    const sourceRecord = await this.sourceRecordService.resolveByKey(source);
    const [latestMetric, syncStatuses] = await Promise.all([
      this.prismaService.sourceHealthMetric.findFirst({
        where: {
          sourceId: sourceRecord.id,
        },
        orderBy: {
          recordedAt: 'desc',
        },
      }),
      this.prismaService.sourceSyncStatus.findMany({
        where: {
          sourceId: sourceRecord.id,
        },
      }),
    ]);

    if (!latestMetric) {
      return {
        status: 'unknown',
        checkedAt: new Date(),
        consecutiveFailures: 0,
      };
    }

    const consecutiveFailures = syncStatuses.reduce(
      (highestCount, syncStatus) =>
        Math.max(highestCount, syncStatus.consecutiveFailureCount),
      0,
    );
    const lastSuccessfulSyncAt = syncStatuses
      .map((syncStatus) => syncStatus.lastSuccessfulAt)
      .filter((value): value is Date => value instanceof Date)
      .sort((left, right) => right.getTime() - left.getTime())[0];
    const lastFailureAt = syncStatuses
      .map((syncStatus) => syncStatus.lastFailureAt)
      .filter((value): value is Date => value instanceof Date)
      .sort((left, right) => right.getTime() - left.getTime())[0];

    return {
      status: this.mapHealthStatus(latestMetric.status),
      checkedAt: latestMetric.recordedAt,
      consecutiveFailures,
      ...(lastSuccessfulSyncAt ? { lastSuccessfulSyncAt } : {}),
      ...(lastFailureAt ? { lastFailureAt } : {}),
      ...(latestMetric.latencyP95Ms
        ? { latencyMs: latestMetric.latencyP95Ms }
        : {}),
      ...(latestMetric.details
        ? { detail: JSON.stringify(latestMetric.details) }
        : {}),
    };
  }

  getLatestSyncStatus(
    source: SourceAdapterKey,
    syncType: SyncType,
  ): Promise<SourceSyncStatus | null> {
    return this.sourceRecordService.resolveByKey(source).then((sourceRecord) =>
      this.prismaService.sourceSyncStatus.findUnique({
        where: {
          sourceId_syncType: {
            sourceId: sourceRecord.id,
            syncType,
          },
        },
      }),
    );
  }

  async hasActiveSyncJob(source: SourceAdapterKey): Promise<boolean> {
    const sourceRecord = await this.sourceRecordService.resolveByKey(source);
    const activeJob = await this.prismaService.jobRun.findFirst({
      where: {
        sourceId: sourceRecord.id,
        jobType: JobType.SYNC,
        status: {
          in: [JobRunStatus.QUEUED, JobRunStatus.RUNNING],
        },
        finishedAt: null,
      },
      select: {
        id: true,
      },
    });

    return Boolean(activeJob);
  }

  private mapHealthStatus(status: HealthStatus): SourceHealthModel['status'] {
    switch (status) {
      case HealthStatus.OK:
        return 'healthy';
      case HealthStatus.DEGRADED:
        return 'degraded';
      case HealthStatus.FAILED:
        return 'down';
    }
  }
}
