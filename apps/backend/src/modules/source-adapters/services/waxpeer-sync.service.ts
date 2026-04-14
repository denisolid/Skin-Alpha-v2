import { createHash } from 'crypto';

import { HealthStatus, SyncStatus, SyncType, type Prisma } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../infrastructure/config/app-config.service';
import {
  WAXPEER_MASS_INFO_ENDPOINT_NAME,
  WAXPEER_SYNC_MARKET_JOB_NAME,
  WAXPEER_SYNC_MARKET_QUEUE_NAME,
} from '../domain/waxpeer.constants';
import type { WaxpeerSyncJobData } from '../dto/waxpeer-sync.job.dto';
import { RawPayloadArchiveService } from './raw-payload-archive.service';
import { PendingSourceMappingService } from './pending-source-mapping.service';
import { SourceFetchJobService } from './source-fetch-job.service';
import { SourceFreshnessService } from './source-freshness.service';
import { SourceListingStorageService } from './source-listing-storage.service';
import { SourceOperationsService } from './source-operations.service';
import { SourcePayloadNormalizationService } from './source-payload-normalization.service';
import { SourceProvenanceService } from './source-provenance.service';
import {
  WaxpeerHttpClientService,
  WaxpeerHttpError,
} from './waxpeer-http-client.service';
import { WaxpeerMarketStateService } from './waxpeer-market-state.service';
import { WaxpeerRateLimitService } from './waxpeer-rate-limit.service';
import { OverlapAwareSourceUniverseService } from './overlap-aware-source-universe.service';

@Injectable()
export class WaxpeerSyncService {
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
    @Inject(WaxpeerHttpClientService)
    private readonly waxpeerHttpClientService: WaxpeerHttpClientService,
    @Inject(WaxpeerMarketStateService)
    private readonly waxpeerMarketStateService: WaxpeerMarketStateService,
    @Inject(WaxpeerRateLimitService)
    private readonly waxpeerRateLimitService: WaxpeerRateLimitService,
    @Inject(OverlapAwareSourceUniverseService)
    private readonly overlapAwareSourceUniverseService: OverlapAwareSourceUniverseService,
  ) {}

  async syncMarket(input: WaxpeerSyncJobData): Promise<void> {
    const payload = this.serializeJson(input);
    const jobRunId = input.externalJobId
      ? await this.sourceOperationsService.startQueuedJobRun({
          source: 'waxpeer',
          queueName: WAXPEER_SYNC_MARKET_QUEUE_NAME,
          jobName: WAXPEER_SYNC_MARKET_JOB_NAME,
          externalJobId: input.externalJobId,
          ...(payload ? { payload } : {}),
        })
      : await this.sourceOperationsService.startJobRun({
          source: 'waxpeer',
          queueName: WAXPEER_SYNC_MARKET_QUEUE_NAME,
          jobName: WAXPEER_SYNC_MARKET_JOB_NAME,
          ...(payload ? { payload } : {}),
        });

    try {
      if (!this.configService.isWaxpeerEnabled()) {
        await this.cancelSync(jobRunId, {
          reason: 'waxpeer_not_configured',
        });

        return;
      }

      const startedAt = new Date();
      const batches =
        await this.overlapAwareSourceUniverseService.selectPriorityBatches({
          source: 'waxpeer',
          batchBudget: Math.max(
            1,
            input.batchBudget ?? this.configService.waxpeerBatchBudget,
          ),
          batchSize: Math.max(1, this.configService.waxpeerNameBatchSize),
          staleAfterMs: 18 * 60 * 1000,
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
        source: 'waxpeer',
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
      let unchangedBatchSkips = 0;
      let pendingMappings = 0;

      for (const batch of batches) {
        const reservation = await this.waxpeerRateLimitService.reserve(1);

        if (!reservation.granted) {
          rateLimited = true;
          break;
        }

        const requestStartedAt = Date.now();
        const targetItemVariantIds = batch.targets.map(
          (target) => target.itemVariantId,
        );
        const targetNames = batch.targets.map((target) => target.marketHashName);

        try {
          const response = await this.waxpeerHttpClientService.fetchMassInfo({
            names: targetNames,
          });
          const observedAt = new Date();
          const archive = await this.rawPayloadArchiveService.archive({
            source: 'waxpeer',
            endpointName: WAXPEER_MASS_INFO_ENDPOINT_NAME,
            observedAt,
            payload: response,
            jobRunId,
            externalId: batch.batchId,
            requestFingerprint: this.buildRequestFingerprint(batch.targets),
            requestMeta: {
              batchId: batch.batchId,
              targetItemVariantIds,
              targetNames,
              syncStartedAt: startedAt.toISOString(),
            },
            responseMeta: {
              bucketCount: Object.keys(response.data).length,
              returnedListingCount: Object.values(response.data).reduce(
                (total, bucket) => total + bucket.listings.length,
                0,
              ),
            },
            contentType: 'application/json',
            httpStatus: 200,
          });
          const normalizedPayload =
            await this.sourcePayloadNormalizationService.normalizeArchivedPayload({
              rawPayloadArchiveId: archive.id,
              source: 'waxpeer',
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
            ? await this.waxpeerMarketStateService.refreshHeartbeatForVariants({
                itemVariantIds: targetItemVariantIds,
                observedAt,
                ...(normalizedPayload.normalizedAt
                  ? { updatedAt: normalizedPayload.normalizedAt }
                  : {}),
              })
            : (
                await this.waxpeerMarketStateService.reconcileAndRebuild({
                  syncStartedAt: startedAt,
                  observedAt,
                  sourceListingIds: listingStorageResult.sourceListingIds,
                  targetItemVariantIds,
                })
              ).rebuiltStateCount;

          listingsStored += listingStorageResult.storedCount;
          marketStatesRebuilt += rebuildResult;
          pendingMappings += currentPendingMappings;
          if (skippedAsEquivalent) {
            unchangedBatchSkips += 1;
          }
          totalLatencyMs += Date.now() - requestStartedAt;
          successCount += 1;

          await this.sourceOperationsService.recordHealthMetric({
            source: 'waxpeer',
            status: HealthStatus.OK,
            availabilityRatio: 1,
            errorRate: 0,
            latencyMs: Date.now() - requestStartedAt,
            ...(response.rateLimit?.remaining !== undefined
              ? { rateLimitRemaining: response.rateLimit.remaining }
              : {}),
            details: {
              endpointName: WAXPEER_MASS_INFO_ENDPOINT_NAME,
              batchId: batch.batchId,
              targetCount: batch.targets.length,
              equivalentSkip: skippedAsEquivalent,
            } satisfies Prisma.InputJsonValue,
          });
        } catch (error) {
          failureCount += 1;
          totalLatencyMs += Date.now() - requestStartedAt;

          if (error instanceof WaxpeerHttpError && error.statusCode === 429) {
            rateLimited = true;
            await this.waxpeerRateLimitService.markRateLimited(
              error.retryAfterSeconds,
            );
            break;
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
        unchangedBatchSkips,
        pendingMappings,
      } satisfies Prisma.InputJsonValue;

      if (successCount > 0) {
        await this.sourceOperationsService.completeJobRun({
          jobRunId,
          result,
        });
        await this.sourceOperationsService.upsertSyncStatus({
          source: 'waxpeer',
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
          source: 'waxpeer',
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
          'Waxpeer sync completed without a successful listing snapshot.',
        result,
      });
      await this.sourceOperationsService.upsertSyncStatus({
        source: 'waxpeer',
        syncType: SyncType.LISTINGS,
        status: SyncStatus.FAILED,
        jobRunId,
        markFailed: true,
        details: result,
      });
      await this.sourceOperationsService.recordHealthMetric({
        source: 'waxpeer',
        status: HealthStatus.FAILED,
        availabilityRatio: 0,
        errorRate: 1,
        details: result,
      });
    } catch (error) {
      const failureDetails = {
        error:
          error instanceof Error ? error.message : 'Unknown Waxpeer error',
      } satisfies Prisma.InputJsonValue;

      await this.sourceOperationsService.failJobRun({
        jobRunId,
        errorMessage:
          error instanceof Error ? error.message : 'Unknown Waxpeer error',
        result: failureDetails,
      });
      await this.sourceOperationsService.upsertSyncStatus({
        source: 'waxpeer',
        syncType: SyncType.LISTINGS,
        status: SyncStatus.FAILED,
        jobRunId,
        markFailed: true,
        details: failureDetails,
      });
      await this.sourceOperationsService.recordHealthMetric({
        source: 'waxpeer',
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
      source: 'waxpeer',
      syncType: SyncType.LISTINGS,
      status: SyncStatus.IDLE,
      jobRunId,
      details,
    });
  }

  private buildRequestFingerprint(
    targets: readonly {
      readonly itemVariantId: string;
      readonly marketHashName: string;
    }[],
  ): string {
    const fingerprintPayload = targets
      .map((target) => `${target.itemVariantId}:${target.marketHashName}`)
      .sort()
      .join('|');

    return `waxpeer:${createHash('sha256').update(fingerprintPayload).digest('hex')}`;
  }

  private serializeJson(value: unknown): Prisma.InputJsonValue | null {
    if (value === undefined) {
      return null;
    }

    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
