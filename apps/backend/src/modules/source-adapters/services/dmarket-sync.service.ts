import { HealthStatus, SyncStatus, SyncType, type Prisma } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../infrastructure/config/app-config.service';
import {
  DMARKET_MARKET_ITEMS_ENDPOINT_NAME,
  DMARKET_SYNC_MARKET_JOB_NAME,
  DMARKET_SYNC_MARKET_QUEUE_NAME,
} from '../domain/dmarket.constants';
import type { DMarketSyncJobData } from '../dto/dmarket-sync.job.dto';
import { RawPayloadArchiveService } from './raw-payload-archive.service';
import { PendingSourceMappingService } from './pending-source-mapping.service';
import { SourceFetchJobService } from './source-fetch-job.service';
import { SourceFreshnessService } from './source-freshness.service';
import { SourceListingStorageService } from './source-listing-storage.service';
import { SourceOperationsService } from './source-operations.service';
import { SourcePayloadNormalizationService } from './source-payload-normalization.service';
import { SourceProvenanceService } from './source-provenance.service';
import {
  DMarketHttpClientService,
  DMarketHttpError,
} from './dmarket-http-client.service';
import { DMarketMarketStateService } from './dmarket-market-state.service';
import { DMarketRateLimitService } from './dmarket-rate-limit.service';
import { OverlapAwareSourceUniverseService } from './overlap-aware-source-universe.service';

@Injectable()
export class DMarketSyncService {
  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
    @Inject(RawPayloadArchiveService)
    private readonly rawPayloadArchiveService: RawPayloadArchiveService,
    @Inject(PendingSourceMappingService)
    private readonly pendingSourceMappingService: PendingSourceMappingService,
    @Inject(SourceFetchJobService)
    private readonly sourceFetchJobService: SourceFetchJobService,
    @Inject(SourceFreshnessService)
    private readonly sourceFreshnessService: SourceFreshnessService,
    @Inject(SourceListingStorageService)
    private readonly sourceListingStorageService: SourceListingStorageService,
    @Inject(SourceOperationsService)
    private readonly sourceOperationsService: SourceOperationsService,
    @Inject(SourcePayloadNormalizationService)
    private readonly sourcePayloadNormalizationService: SourcePayloadNormalizationService,
    @Inject(SourceProvenanceService)
    private readonly sourceProvenanceService: SourceProvenanceService,
    @Inject(DMarketHttpClientService)
    private readonly dmarketHttpClientService: DMarketHttpClientService,
    @Inject(DMarketMarketStateService)
    private readonly dmarketMarketStateService: DMarketMarketStateService,
    @Inject(DMarketRateLimitService)
    private readonly dmarketRateLimitService: DMarketRateLimitService,
    @Inject(OverlapAwareSourceUniverseService)
    private readonly overlapAwareSourceUniverseService: OverlapAwareSourceUniverseService,
  ) {}

  async syncMarket(input: DMarketSyncJobData): Promise<void> {
    const payload = this.serializeJson(input);
    const jobRunId = input.externalJobId
      ? await this.sourceOperationsService.startQueuedJobRun({
          source: 'dmarket',
          queueName: DMARKET_SYNC_MARKET_QUEUE_NAME,
          jobName: DMARKET_SYNC_MARKET_JOB_NAME,
          externalJobId: input.externalJobId,
          ...(payload ? { payload } : {}),
        })
      : await this.sourceOperationsService.startJobRun({
          source: 'dmarket',
          queueName: DMARKET_SYNC_MARKET_QUEUE_NAME,
          jobName: DMARKET_SYNC_MARKET_JOB_NAME,
          ...(payload ? { payload } : {}),
        });

    try {
      if (!this.configService.isDMarketEnabled()) {
        await this.cancelSync(jobRunId, {
          reason: 'dmarket_not_configured',
        });

        return;
      }

      const startedAt = new Date();
      const batches =
        await this.overlapAwareSourceUniverseService.selectPriorityBatches({
          source: 'dmarket',
          batchBudget: Math.max(
            1,
            input.batchBudget ?? this.configService.dmarketBatchBudget,
          ),
          batchSize: Math.max(1, this.configService.dmarketBatchSize),
          staleAfterMs: 20 * 60 * 1000,
          ...(input.targetItemVariantIds?.length
            ? { targetItemVariantIds: input.targetItemVariantIds }
            : {}),
          ...(input.force !== undefined ? { force: input.force } : {}),
        });

      if (batches.length === 0) {
        await this.cancelSync(jobRunId, {
          reason: 'no_overlap_candidates',
        });

        return;
      }

      await this.sourceOperationsService.upsertSyncStatus({
        source: 'dmarket',
        syncType: SyncType.LISTINGS,
        status: SyncStatus.RUNNING,
        jobRunId,
        details: {
          batchCount: batches.length,
          targetCount: batches.reduce(
            (total, batch) => total + batch.targets.length,
            0,
          ),
        } satisfies Prisma.InputJsonValue,
      });

      let successCount = 0;
      let failureCount = 0;
      let rateLimited = false;
      let totalLatencyMs = 0;
      let listingsStored = 0;
      let marketStatesRebuilt = 0;
      let unchangedTargetSkips = 0;
      let pendingMappings = 0;

      for (const batch of batches) {
        for (const target of batch.targets) {
          const reservation = await this.dmarketRateLimitService.reserve(1);

          if (!reservation.granted) {
            rateLimited = true;
            break;
          }

          const requestStartedAt = Date.now();

          try {
            const response = await this.dmarketHttpClientService.fetchMarketItems({
              title: target.marketHashName,
              limit: this.configService.dmarketPageLimit,
            });
            const observedAt = new Date();
            const archive = await this.rawPayloadArchiveService.archive({
              source: 'dmarket',
              endpointName: DMARKET_MARKET_ITEMS_ENDPOINT_NAME,
              observedAt,
              payload: response,
              jobRunId,
              externalId: `${target.itemVariantId}:${target.marketHashName}`,
              requestFingerprint: `dmarket:${target.itemVariantId}:initial`,
              requestMeta: {
                canonicalItemId: target.canonicalItemId,
                itemVariantId: target.itemVariantId,
                marketHashName: target.marketHashName,
                syncStartedAt: startedAt.toISOString(),
              },
              responseMeta: {
                cursor: response.cursor ?? null,
                total: response.total ?? null,
              },
              cursor: {
                cursor: response.cursor ?? null,
              },
              contentType: 'application/json',
              httpStatus: 200,
            });
            const normalizedPayload =
              await this.sourcePayloadNormalizationService.normalizeArchivedPayload({
                rawPayloadArchiveId: archive.id,
                source: 'dmarket',
              });
            const listingStorageResult =
              await this.sourceListingStorageService.storeNormalizedListings(
                normalizedPayload,
              );
            const currentPendingMappings =
              await this.pendingSourceMappingService.captureFromPayload(
                normalizedPayload,
              );

            await Promise.all([
              this.sourceProvenanceService.recordListings(
                normalizedPayload,
                listingStorageResult,
              ),
              this.sourceFreshnessService.recordNormalizedPayload(
                normalizedPayload,
              ),
              this.sourceFetchJobService.recordNormalization(
                normalizedPayload.fetchJobId,
                listingStorageResult.storedCount,
                normalizedPayload.warnings.length + currentPendingMappings,
              ),
            ]);

            const skippedAsEquivalent =
              normalizedPayload.listings.length === 0 &&
              normalizedPayload.warnings.length > 0 &&
              normalizedPayload.warnings.every((warning) =>
                warning.startsWith('Skipped unchanged '),
              );
            const rebuildResult = skippedAsEquivalent
              ? await this.dmarketMarketStateService.refreshHeartbeatForVariants({
                  itemVariantIds: [target.itemVariantId],
                  observedAt,
                  ...(normalizedPayload.normalizedAt
                    ? { updatedAt: normalizedPayload.normalizedAt }
                    : {}),
                })
              : (
                  await this.dmarketMarketStateService.reconcileAndRebuild({
                    syncStartedAt: startedAt,
                    observedAt,
                    sourceListingIds: listingStorageResult.sourceListingIds,
                    targetItemVariantIds: [target.itemVariantId],
                  })
                ).rebuiltStateCount;

            listingsStored += listingStorageResult.storedCount;
            marketStatesRebuilt += rebuildResult;
            pendingMappings += currentPendingMappings;
            if (skippedAsEquivalent) {
              unchangedTargetSkips += 1;
            }
            totalLatencyMs += Date.now() - requestStartedAt;
            successCount += 1;

            await this.sourceOperationsService.recordHealthMetric({
              source: 'dmarket',
              status: HealthStatus.OK,
              availabilityRatio: 1,
              errorRate: 0,
              latencyMs: Date.now() - requestStartedAt,
              ...(response.rateLimit?.remaining !== undefined
                ? { rateLimitRemaining: response.rateLimit.remaining }
                : {}),
              details: {
                endpointName: DMARKET_MARKET_ITEMS_ENDPOINT_NAME,
                title: target.marketHashName,
                itemVariantId: target.itemVariantId,
                equivalentSkip: skippedAsEquivalent,
              } satisfies Prisma.InputJsonValue,
            });
          } catch (error) {
            failureCount += 1;
            totalLatencyMs += Date.now() - requestStartedAt;

            if (error instanceof DMarketHttpError && error.statusCode === 429) {
              rateLimited = true;
              await this.dmarketRateLimitService.markRateLimited(
                error.retryAfterSeconds,
              );
              break;
            }
          }
        }

        if (rateLimited) {
          break;
        }
      }

      const result = {
        batchCount: batches.length,
        successCount,
        failureCount,
        rateLimited,
        listingsStored,
        marketStatesRebuilt,
        unchangedTargetSkips,
        pendingMappings,
      } satisfies Prisma.InputJsonValue;

      if (successCount > 0) {
        await this.sourceOperationsService.completeJobRun({
          jobRunId,
          result,
        });
        await this.sourceOperationsService.upsertSyncStatus({
          source: 'dmarket',
          syncType: SyncType.LISTINGS,
          status:
            failureCount > 0 || rateLimited
              ? SyncStatus.DEGRADED
              : SyncStatus.SUCCEEDED,
          jobRunId,
          markSuccessful: true,
          details: result,
        });
        await this.sourceOperationsService.recordHealthMetric({
          source: 'dmarket',
          status:
            failureCount > 0 || rateLimited
              ? HealthStatus.DEGRADED
              : HealthStatus.OK,
          availabilityRatio:
            successCount / Math.max(1, successCount + failureCount),
          errorRate: failureCount / Math.max(1, successCount + failureCount),
          latencyMs: Math.round(
            totalLatencyMs / Math.max(1, successCount + failureCount),
          ),
          ...(rateLimited ? { rateLimitRemaining: 0 } : {}),
          details: result,
        });

        return;
      }

      await this.sourceOperationsService.failJobRun({
        jobRunId,
        errorMessage:
          'DMarket sync completed without a successful listing snapshot.',
        result,
      });
      await this.sourceOperationsService.upsertSyncStatus({
        source: 'dmarket',
        syncType: SyncType.LISTINGS,
        status: SyncStatus.FAILED,
        jobRunId,
        markFailed: true,
        details: result,
      });
      await this.sourceOperationsService.recordHealthMetric({
        source: 'dmarket',
        status: HealthStatus.FAILED,
        availabilityRatio: 0,
        errorRate: 1,
        details: result,
      });
    } catch (error) {
      const failureDetails = {
        error:
          error instanceof Error ? error.message : 'Unknown DMarket error',
      } satisfies Prisma.InputJsonValue;

      await this.sourceOperationsService.failJobRun({
        jobRunId,
        errorMessage:
          error instanceof Error ? error.message : 'Unknown DMarket error',
        result: failureDetails,
      });
      await this.sourceOperationsService.upsertSyncStatus({
        source: 'dmarket',
        syncType: SyncType.LISTINGS,
        status: SyncStatus.FAILED,
        jobRunId,
        markFailed: true,
        details: failureDetails,
      });
      await this.sourceOperationsService.recordHealthMetric({
        source: 'dmarket',
        status: HealthStatus.FAILED,
        availabilityRatio: 0,
        errorRate: 1,
        details: failureDetails,
      });
      throw error;
    }
  }

  private async cancelSync(
    jobRunId: string,
    details: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.sourceOperationsService.cancelJobRun({
      jobRunId,
      result: details,
    });
    await this.sourceOperationsService.upsertSyncStatus({
      source: 'dmarket',
      syncType: SyncType.LISTINGS,
      status: SyncStatus.IDLE,
      jobRunId,
      details,
    });
  }

  private serializeJson(value: unknown): Prisma.InputJsonValue | null {
    if (value === undefined) {
      return null;
    }

    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
