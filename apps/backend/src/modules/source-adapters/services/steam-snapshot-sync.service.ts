import {
  ArchiveEntityType,
  HealthStatus,
  SyncStatus,
  SyncType,
  type Prisma,
} from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../infrastructure/config/app-config.service';
import { MarketStateUpdaterService } from '../../market-state/services/market-state-updater.service';
import { UPDATE_MARKET_STATE_QUEUE_NAME } from '../domain/source-ingestion.constants';
import { RawPayloadArchiveService } from './raw-payload-archive.service';
import { IngestionDiagnosticsService } from './ingestion-diagnostics.service';
import { PendingSourceMappingService } from './pending-source-mapping.service';
import { SourceFetchJobService } from './source-fetch-job.service';
import { SourceFreshnessService } from './source-freshness.service';
import { SourceMarketFactStorageService } from './source-market-fact-storage.service';
import { SourceOperationsService } from './source-operations.service';
import { SourcePayloadNormalizationService } from './source-payload-normalization.service';
import { SourceProvenanceService } from './source-provenance.service';
import { SteamSnapshotUniverseService } from './steam-snapshot-universe.service';
import {
  SteamSnapshotHttpClientService,
  SteamSnapshotHttpError,
} from './steam-snapshot-http-client.service';
import { SteamSnapshotRateLimitService } from './steam-snapshot-rate-limit.service';
import { SteamSnapshotFallbackService } from './steam-snapshot-fallback.service';
import {
  STEAM_SNAPSHOT_PRICEOVERVIEW_BATCH_ENDPOINT_NAME,
  STEAM_SNAPSHOT_SYNC_QUEUE_NAME,
} from '../domain/steam-snapshot.constants';
import type {
  SteamSnapshotBatchPlanDto,
  SteamSnapshotFetchedItemDto,
} from '../dto/steam-snapshot.dto';
import type { SteamSnapshotSyncJobData } from '../dto/steam-snapshot.job.dto';

interface SteamSnapshotBatchProcessingResult {
  readonly targetCount: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly snapshotCount: number;
  readonly updatedStateCount: number;
  readonly rateLimited: boolean;
}

@Injectable()
export class SteamSnapshotSyncService {
  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
    @Inject(RawPayloadArchiveService)
    private readonly rawPayloadArchiveService: RawPayloadArchiveService,
    @Inject(IngestionDiagnosticsService)
    private readonly ingestionDiagnosticsService: IngestionDiagnosticsService,
    @Inject(MarketStateUpdaterService)
    private readonly marketStateUpdaterService: MarketStateUpdaterService,
    @Inject(PendingSourceMappingService)
    private readonly pendingSourceMappingService: PendingSourceMappingService,
    @Inject(SourceFetchJobService)
    private readonly sourceFetchJobService: SourceFetchJobService,
    @Inject(SourceFreshnessService)
    private readonly sourceFreshnessService: SourceFreshnessService,
    @Inject(SourceMarketFactStorageService)
    private readonly sourceMarketFactStorageService: SourceMarketFactStorageService,
    @Inject(SourceOperationsService)
    private readonly sourceOperationsService: SourceOperationsService,
    @Inject(SourcePayloadNormalizationService)
    private readonly sourcePayloadNormalizationService: SourcePayloadNormalizationService,
    @Inject(SourceProvenanceService)
    private readonly sourceProvenanceService: SourceProvenanceService,
    @Inject(SteamSnapshotUniverseService)
    private readonly steamSnapshotUniverseService: SteamSnapshotUniverseService,
    @Inject(SteamSnapshotHttpClientService)
    private readonly steamSnapshotHttpClientService: SteamSnapshotHttpClientService,
    @Inject(SteamSnapshotRateLimitService)
    private readonly steamSnapshotRateLimitService: SteamSnapshotRateLimitService,
    @Inject(SteamSnapshotFallbackService)
    private readonly steamSnapshotFallbackService: SteamSnapshotFallbackService,
  ) {}

  async syncPriorityBatches(input: SteamSnapshotSyncJobData): Promise<void> {
    const payload = this.serializeJson({
      ...(input.batchBudget !== undefined
        ? { batchBudget: input.batchBudget }
        : {}),
      ...(input.targetItemVariantIds
        ? { targetItemVariantIds: [...input.targetItemVariantIds] }
        : {}),
    });
    const jobRunId = input.externalJobId
      ? await this.sourceOperationsService.startQueuedJobRun({
          source: 'steam-snapshot',
          queueName: STEAM_SNAPSHOT_SYNC_QUEUE_NAME,
          jobName: STEAM_SNAPSHOT_SYNC_QUEUE_NAME,
          externalJobId: input.externalJobId,
          ...(payload ? { payload } : {}),
        })
      : await this.sourceOperationsService.startJobRun({
          source: 'steam-snapshot',
          queueName: STEAM_SNAPSHOT_SYNC_QUEUE_NAME,
          jobName: STEAM_SNAPSHOT_SYNC_QUEUE_NAME,
          ...(payload ? { payload } : {}),
        });

    try {
      if (!this.configService.isSteamSnapshotEnabled()) {
        await this.cancelSync(jobRunId, {
          reason: 'steam_snapshot_disabled',
        });

        return;
      }

      const batches =
        await this.steamSnapshotUniverseService.selectPriorityBatches({
          ...(input.batchBudget !== undefined
            ? { batchBudget: input.batchBudget }
            : {}),
          ...(input.targetItemVariantIds
            ? { targetItemVariantIds: input.targetItemVariantIds }
            : {}),
          ...(input.force !== undefined ? { force: input.force } : {}),
        });

      if (batches.length === 0) {
        const freshness =
          await this.steamSnapshotFallbackService.getFreshness();

        await this.cancelSync(jobRunId, {
          reason: 'steam_snapshot_no_candidates',
          freshness,
        });

        return;
      }

      const runningDetails = this.serializeJson({
        batchCount: batches.length,
        targetCount: batches.reduce(
          (total, batch) => total + batch.targets.length,
          0,
        ),
      });

      await this.sourceOperationsService.upsertSyncStatus({
        source: 'steam-snapshot',
        syncType: SyncType.MARKET_STATE,
        status: SyncStatus.RUNNING,
        jobRunId,
        ...(runningDetails ? { details: runningDetails } : {}),
      });

      let successCount = 0;
      let failureCount = 0;
      let snapshotCount = 0;
      let updatedStateCount = 0;
      let rateLimited = false;
      let totalLatencyMs = 0;

      for (const batch of batches) {
        const batchStartedAt = Date.now();
        const batchResult = await this.processBatch(
          batch,
          input.requestedAt,
          jobRunId,
        );

        successCount += batchResult.successCount;
        failureCount += batchResult.failureCount;
        snapshotCount += batchResult.snapshotCount;
        updatedStateCount += batchResult.updatedStateCount;
        rateLimited = rateLimited || batchResult.rateLimited;
        totalLatencyMs += Date.now() - batchStartedAt;

        if (batchResult.rateLimited) {
          break;
        }
      }

      const freshness = await this.steamSnapshotFallbackService.getFreshness();
      const details = this.serializeJson({
        batchCount: batches.length,
        successCount,
        failureCount,
        snapshotCount,
        updatedStateCount,
        rateLimited,
        freshness,
      });
      const partialFailure = failureCount > 0 || rateLimited;

      if (successCount > 0) {
        await this.sourceOperationsService.completeJobRun({
          jobRunId,
          ...(details ? { result: details } : {}),
        });
        await this.sourceOperationsService.upsertSyncStatus({
          source: 'steam-snapshot',
          syncType: SyncType.MARKET_STATE,
          status: partialFailure ? SyncStatus.DEGRADED : SyncStatus.SUCCEEDED,
          jobRunId,
          markSuccessful: true,
          ...(details ? { details } : {}),
        });
        await this.sourceOperationsService.recordHealthMetric({
          source: 'steam-snapshot',
          status: partialFailure ? HealthStatus.DEGRADED : HealthStatus.OK,
          availabilityRatio:
            successCount / Math.max(1, successCount + failureCount),
          errorRate: failureCount / Math.max(1, successCount + failureCount),
          latencyMs: Math.round(totalLatencyMs / Math.max(1, batches.length)),
          ...(details ? { details } : {}),
        });

        return;
      }

      const failureDisposition =
        await this.steamSnapshotFallbackService.resolveFailureDisposition();
      const failureDetails = this.serializeJson({
        reason: 'steam_snapshot_no_successful_batches',
        freshness: failureDisposition.freshness,
        fallbackUsable: failureDisposition.fallbackUsable,
      });

      await this.sourceOperationsService.failJobRun({
        jobRunId,
        errorMessage:
          'Steam snapshot batches completed without fresh market states.',
        ...(failureDetails ? { result: failureDetails } : {}),
      });
      await this.sourceOperationsService.upsertSyncStatus({
        source: 'steam-snapshot',
        syncType: SyncType.MARKET_STATE,
        status: failureDisposition.fallbackUsable
          ? SyncStatus.DEGRADED
          : SyncStatus.FAILED,
        jobRunId,
        markFailed: true,
        ...(failureDetails ? { details: failureDetails } : {}),
      });
      await this.sourceOperationsService.recordHealthMetric({
        source: 'steam-snapshot',
        status: failureDisposition.healthStatus,
        availabilityRatio: 0,
        errorRate: 1,
        ...(failureDetails ? { details: failureDetails } : {}),
      });
    } catch (error) {
      if (error instanceof SteamSnapshotHttpError && error.statusCode === 429) {
        await this.steamSnapshotRateLimitService.markRateLimited(
          error.retryAfterSeconds,
        );
      }

      const failureDisposition =
        await this.steamSnapshotFallbackService.resolveFailureDisposition();
      const failureDetails = this.serializeJson({
        error:
          error instanceof Error
            ? error.message
            : 'Unknown Steam snapshot error',
        freshness: failureDisposition.freshness,
        fallbackUsable: failureDisposition.fallbackUsable,
      });

      await this.sourceOperationsService.failJobRun({
        jobRunId,
        errorMessage:
          error instanceof Error
            ? error.message
            : 'Unknown Steam snapshot error',
        ...(failureDetails ? { result: failureDetails } : {}),
      });
      await this.sourceOperationsService.upsertSyncStatus({
        source: 'steam-snapshot',
        syncType: SyncType.MARKET_STATE,
        status: failureDisposition.fallbackUsable
          ? SyncStatus.DEGRADED
          : SyncStatus.FAILED,
        jobRunId,
        markFailed: true,
        ...(failureDetails ? { details: failureDetails } : {}),
      });
      await this.sourceOperationsService.recordHealthMetric({
        source: 'steam-snapshot',
        status: failureDisposition.healthStatus,
        availabilityRatio: 0,
        errorRate: 1,
        ...(failureDetails ? { details: failureDetails } : {}),
      });

      throw error;
    }
  }

  private async processBatch(
    batch: SteamSnapshotBatchPlanDto,
    requestedAt: string,
    jobRunId: string,
  ): Promise<SteamSnapshotBatchProcessingResult> {
    const fetchedItems: SteamSnapshotFetchedItemDto[] = [];
    let rateLimited = false;

    for (const target of batch.targets) {
      const reservation =
        await this.steamSnapshotRateLimitService.reserveRequestSlot(1);

      if (!reservation.granted) {
        rateLimited = true;
        fetchedItems.push({
          target,
          fetchedAt: new Date().toISOString(),
          httpStatus: 429,
          errorCode: 'steam_snapshot_rate_limit',
          errorMessage:
            'Steam snapshot rate budget exhausted for current window.',
        });
        break;
      }

      try {
        const priceOverview =
          await this.steamSnapshotHttpClientService.fetchPriceOverview(
            target.marketHashName,
          );

        fetchedItems.push({
          target,
          fetchedAt: new Date().toISOString(),
          httpStatus: 200,
          priceOverview,
        });
      } catch (error) {
        if (
          error instanceof SteamSnapshotHttpError &&
          error.statusCode === 429
        ) {
          rateLimited = true;
        }

        fetchedItems.push({
          target,
          fetchedAt: new Date().toISOString(),
          httpStatus:
            error instanceof SteamSnapshotHttpError && error.statusCode
              ? error.statusCode
              : 500,
          ...(error instanceof SteamSnapshotHttpError
            ? { errorCode: 'steam_snapshot_http_error' }
            : { errorCode: 'steam_snapshot_unknown_error' }),
          errorMessage:
            error instanceof Error
              ? error.message
              : 'Unknown Steam snapshot error',
        });

        if (rateLimited) {
          break;
        }
      }

      if (this.configService.steamSnapshotRequestDelayMs > 0) {
        await this.sleep(this.configService.steamSnapshotRequestDelayMs);
      }
    }

    const observedAt = new Date();
    const archive = await this.rawPayloadArchiveService.archive({
      source: 'steam-snapshot',
      endpointName: STEAM_SNAPSHOT_PRICEOVERVIEW_BATCH_ENDPOINT_NAME,
      observedAt,
      payload: {
        batchId: batch.batchId,
        requestedAt,
        observedAt: observedAt.toISOString(),
        items: fetchedItems,
        stalePolicy: {
          staleAfterMinutes: this.configService.steamSnapshotStaleAfterMinutes,
          maxStaleMinutes: this.configService.steamSnapshotMaxStaleMinutes,
        },
      },
      jobRunId,
      externalId: batch.batchId,
      entityType: ArchiveEntityType.SOURCE_SYNC,
      contentType: 'application/json',
      httpStatus: fetchedItems.every((item) => item.httpStatus === 200)
        ? 200
        : 207,
    });
    const normalizedPayload =
      await this.sourcePayloadNormalizationService.normalizeArchivedPayload({
        rawPayloadArchiveId: archive.id,
        source: 'steam-snapshot',
      });
    const marketFactStorageResult =
      await this.sourceMarketFactStorageService.storeNormalizedMarketFacts(
        normalizedPayload,
      );
    const pendingMappings =
      await this.pendingSourceMappingService.captureFromPayload(
        normalizedPayload,
      );

    await Promise.all([
      this.sourceProvenanceService.recordMarketFacts(
        normalizedPayload,
        marketFactStorageResult,
      ),
      this.sourceFreshnessService.recordNormalizedPayload(normalizedPayload),
      this.sourceFetchJobService.recordNormalization(
        normalizedPayload.fetchJobId,
        marketFactStorageResult.storedCount,
        normalizedPayload.warnings.length + pendingMappings,
      ),
    ]);

    const marketStateResult =
      normalizedPayload.marketStates.length === 0
        ? {
            source: 'steam-snapshot' as const,
            rawPayloadArchiveId: archive.id,
            snapshotCount: 0,
            upsertedStateCount: 0,
            skippedCount: 0,
            unchangedProjectionSkipCount: 0,
          }
        : await this.projectMarketStates(archive.id, normalizedPayload.marketStates);

    return {
      targetCount: batch.targets.length,
      successCount: fetchedItems.filter(
        (item) => item.httpStatus === 200 && item.priceOverview?.success,
      ).length,
      failureCount: fetchedItems.filter(
        (item) => item.httpStatus !== 200 || !item.priceOverview?.success,
      ).length,
      snapshotCount: marketStateResult.snapshotCount,
      updatedStateCount: marketStateResult.upsertedStateCount,
      rateLimited,
    };
  }

  private async projectMarketStates(
    rawPayloadArchiveId: string,
    marketStates: Awaited<
      ReturnType<SourcePayloadNormalizationService['normalizeArchivedPayload']>
    >['marketStates'],
  ) {
    const projectionStartedAt = Date.now();
    const marketStateResult =
      await this.marketStateUpdaterService.updateLatestStateBatch({
        source: 'steam-snapshot',
        marketStates,
        rawPayloadArchiveId,
      });
    await this.sourceFreshnessService.markProjectedMarketStates({
      source: 'steam-snapshot',
      marketStates,
      updatedAt: new Date(),
    });
    await this.ingestionDiagnosticsService.recordStageMetric({
      source: 'steam-snapshot',
      stage: UPDATE_MARKET_STATE_QUEUE_NAME,
      status:
        marketStateResult.skippedCount > 0
          ? HealthStatus.DEGRADED
          : HealthStatus.OK,
      latencyMs: Date.now() - projectionStartedAt,
      details: {
        snapshotCount: marketStateResult.snapshotCount,
        upsertedStateCount: marketStateResult.upsertedStateCount,
        skippedCount: marketStateResult.skippedCount,
        unchangedProjectionSkipCount:
          marketStateResult.unchangedProjectionSkipCount,
      },
    });

    return marketStateResult;
  }

  private async cancelSync(jobRunId: string, details: unknown): Promise<void> {
    const result = this.serializeJson(details);

    await this.sourceOperationsService.cancelJobRun({
      jobRunId,
      ...(result ? { result } : {}),
    });
    await this.sourceOperationsService.upsertSyncStatus({
      source: 'steam-snapshot',
      syncType: SyncType.MARKET_STATE,
      status: SyncStatus.IDLE,
      jobRunId,
      ...(result ? { details: result } : {}),
    });
  }

  private serializeJson(value: unknown): Prisma.InputJsonValue | null {
    if (value === undefined) {
      return null;
    }

    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private sleep(durationMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, durationMs));
  }
}
