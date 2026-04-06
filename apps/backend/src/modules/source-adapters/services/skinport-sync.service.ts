import {
  HealthStatus,
  SyncStatus,
  SyncType,
  type Prisma,
} from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../infrastructure/config/app-config.service';
import { SourceIngestionService } from './source-ingestion.service';
import { SourceOperationsService } from './source-operations.service';
import {
  SkinportHttpClientService,
  SkinportHttpError,
} from './skinport-http-client.service';
import { SkinportRateLimitService } from './skinport-rate-limit.service';
import type { SkinportSyncJobData } from '../dto/skinport-sync.job.dto';

interface ExecuteSnapshotSyncInput {
  readonly queueName: string;
  readonly jobName: string;
  readonly syncType: SyncType;
  readonly endpointName: string;
  readonly externalJobId?: string;
  readonly payload?: Prisma.InputJsonValue;
  readonly force?: boolean;
  readonly fetchPayload: () => Promise<unknown>;
}

@Injectable()
export class SkinportSyncService {
  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
    @Inject(SourceIngestionService)
    private readonly sourceIngestionService: SourceIngestionService,
    @Inject(SourceOperationsService)
    private readonly sourceOperationsService: SourceOperationsService,
    @Inject(SkinportRateLimitService)
    private readonly skinportRateLimitService: SkinportRateLimitService,
    @Inject(SkinportHttpClientService)
    private readonly skinportHttpClientService: SkinportHttpClientService,
  ) {}

  syncItemsSnapshot(input: SkinportSyncJobData): Promise<void> {
    return this.executeSnapshotSync({
      queueName: 'skinport-sync-items-snapshot',
      jobName: 'skinport-sync-items-snapshot',
      syncType: SyncType.LISTINGS,
      endpointName: 'skinport-items-snapshot',
      ...(input.externalJobId ? { externalJobId: input.externalJobId } : {}),
      payload: this.serializeJson(input),
      ...(input.force !== undefined ? { force: input.force } : {}),
      fetchPayload: () => this.skinportHttpClientService.fetchItemsSnapshot(),
    });
  }

  syncSalesHistory(input: SkinportSyncJobData): Promise<void> {
    return this.executeSnapshotSync({
      queueName: 'skinport-sync-sales-history',
      jobName: 'skinport-sync-sales-history',
      syncType: SyncType.MARKET_STATE,
      endpointName: 'skinport-sales-history',
      ...(input.externalJobId ? { externalJobId: input.externalJobId } : {}),
      payload: this.serializeJson(input),
      ...(input.force !== undefined ? { force: input.force } : {}),
      fetchPayload: () => this.skinportHttpClientService.fetchSalesHistory(),
    });
  }

  async ingestSaleFeedPayload(
    payload: unknown,
    observedAt: Date,
  ): Promise<void> {
    await this.sourceIngestionService.enqueueRawPayload({
      source: 'skinport',
      endpointName: 'skinport-sale-feed',
      observedAt,
      payload,
    });
  }

  private async executeSnapshotSync(
    input: ExecuteSnapshotSyncInput,
  ): Promise<void> {
    const jobRunId = input.externalJobId
      ? await this.sourceOperationsService.startQueuedJobRun({
          source: 'skinport',
          queueName: input.queueName,
          jobName: input.jobName,
          externalJobId: input.externalJobId,
          ...(input.payload ? { payload: input.payload } : {}),
        })
      : await this.sourceOperationsService.startJobRun({
          source: 'skinport',
          queueName: input.queueName,
          jobName: input.jobName,
          ...(input.payload ? { payload: input.payload } : {}),
        });

    try {
      const latestSyncStatus =
        await this.sourceOperationsService.getLatestSyncStatus(
          'skinport',
          input.syncType,
        );

      if (
        !input.force &&
        latestSyncStatus?.lastSuccessfulAt &&
        Date.now() - latestSyncStatus.lastSuccessfulAt.getTime() <
          this.configService.skinportCacheTtlMs
      ) {
        await this.sourceOperationsService.cancelJobRun({
          jobRunId,
          result: {
            reason: 'cache-fresh',
            lastSuccessfulAt: latestSyncStatus.lastSuccessfulAt.toISOString(),
          } satisfies Prisma.InputJsonValue,
        });
        await this.sourceOperationsService.upsertSyncStatus({
          source: 'skinport',
          syncType: input.syncType,
          status: SyncStatus.IDLE,
          jobRunId,
          details: {
            reason: 'cache-fresh',
          } satisfies Prisma.InputJsonValue,
        });

        return;
      }

      const rateLimitReservation =
        await this.skinportRateLimitService.reserveRequestSlot(1);

      if (!rateLimitReservation.granted) {
        await this.sourceOperationsService.cancelJobRun({
          jobRunId,
          result: {
            reason: 'rate-limit',
            retryAfterSeconds: rateLimitReservation.retryAfterSeconds ?? null,
          } satisfies Prisma.InputJsonValue,
        });
        await this.sourceOperationsService.upsertSyncStatus({
          source: 'skinport',
          syncType: input.syncType,
          status: SyncStatus.DEGRADED,
          jobRunId,
          details: {
            reason: 'rate-limit',
            retryAfterSeconds: rateLimitReservation.retryAfterSeconds ?? null,
          } satisfies Prisma.InputJsonValue,
        });
        await this.sourceOperationsService.recordHealthMetric({
          source: 'skinport',
          status: HealthStatus.DEGRADED,
          details: {
            reason: 'rate-limit',
            resetsAt:
              rateLimitReservation.state.resetsAt?.toISOString() ?? null,
          } satisfies Prisma.InputJsonValue,
          ...(rateLimitReservation.state.windowRemaining !== undefined
            ? {
                rateLimitRemaining: rateLimitReservation.state.windowRemaining,
              }
            : {}),
        });

        return;
      }

      await this.sourceOperationsService.upsertSyncStatus({
        source: 'skinport',
        syncType: input.syncType,
        status: SyncStatus.RUNNING,
        jobRunId,
        details: {
          endpointName: input.endpointName,
        } satisfies Prisma.InputJsonValue,
      });

      const startedAt = Date.now();
      const payload = await input.fetchPayload();
      const ingestionResult =
        await this.sourceIngestionService.enqueueRawPayload({
          source: 'skinport',
          endpointName: input.endpointName,
          observedAt: new Date(),
          payload,
          jobRunId,
        });
      const latencyMs = Date.now() - startedAt;

      await this.sourceOperationsService.completeJobRun({
        jobRunId,
        result: {
          rawArchiveJobId: ingestionResult.jobId ?? null,
          endpointName: input.endpointName,
        } satisfies Prisma.InputJsonValue,
      });
      await this.sourceOperationsService.upsertSyncStatus({
        source: 'skinport',
        syncType: input.syncType,
        status: SyncStatus.SUCCEEDED,
        jobRunId,
        markSuccessful: true,
        details: {
          endpointName: input.endpointName,
          rawArchiveJobId: ingestionResult.jobId ?? null,
        } satisfies Prisma.InputJsonValue,
      });
      await this.sourceOperationsService.recordHealthMetric({
        source: 'skinport',
        status: HealthStatus.OK,
        availabilityRatio: 1,
        errorRate: 0,
        latencyMs,
        details: {
          endpointName: input.endpointName,
        } satisfies Prisma.InputJsonValue,
        ...(rateLimitReservation.state.windowRemaining !== undefined
          ? {
              rateLimitRemaining: rateLimitReservation.state.windowRemaining,
            }
          : {}),
      });
    } catch (error) {
      if (error instanceof SkinportHttpError && error.statusCode === 429) {
        await this.skinportRateLimitService.markRateLimited();
      }

      await this.sourceOperationsService.failJobRun({
        jobRunId,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.sourceOperationsService.upsertSyncStatus({
        source: 'skinport',
        syncType: input.syncType,
        status: SyncStatus.FAILED,
        jobRunId,
        markFailed: true,
        details: {
          error:
            error instanceof Error ? error.message : 'Unknown Skinport error',
        } satisfies Prisma.InputJsonValue,
      });
      await this.sourceOperationsService.recordHealthMetric({
        source: 'skinport',
        status: HealthStatus.FAILED,
        availabilityRatio: 0,
        errorRate: 1,
        details: {
          error:
            error instanceof Error ? error.message : 'Unknown Skinport error',
        } satisfies Prisma.InputJsonValue,
      });

      throw error;
    }
  }

  private serializeJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
