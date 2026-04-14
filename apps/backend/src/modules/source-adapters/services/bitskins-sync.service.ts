import { createHash } from 'crypto';

import {
  HealthStatus,
  SyncStatus,
  SyncType,
  type Prisma,
} from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../infrastructure/config/app-config.service';
import {
  BITSKINS_LISTINGS_ENDPOINT_NAME,
  BITSKINS_SYNC_JOB_NAME,
  BITSKINS_SYNC_QUEUE_NAME,
} from '../domain/managed-market.constants';
import type { ManagedMarketSyncJobData } from '../domain/managed-market-source.types';
import { NormalizedMarketStateDeltaService } from './normalized-market-state-delta.service';
import { RawPayloadArchiveService } from './raw-payload-archive.service';
import { PendingSourceMappingService } from './pending-source-mapping.service';
import { SourceFetchJobService } from './source-fetch-job.service';
import { SourceFreshnessService } from './source-freshness.service';
import { SourceListingStorageService } from './source-listing-storage.service';
import { SourceMarketFactStorageService } from './source-market-fact-storage.service';
import { SourceOperationsService } from './source-operations.service';
import { SourcePayloadNormalizationService } from './source-payload-normalization.service';
import { SourceProvenanceService } from './source-provenance.service';
import { OverlapAwareSourceUniverseService } from './overlap-aware-source-universe.service';
import { ManagedMarketSourceRuntimeService } from './managed-market-source-runtime.service';
import {
  BitSkinsHttpClientService,
  BitSkinsHttpError,
} from './bitskins-http-client.service';
import { BitSkinsMarketStateService } from './bitskins-market-state.service';

@Injectable()
export class BitSkinsSyncService {
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
    @Inject(SourceMarketFactStorageService)
    private readonly sourceMarketFactStorageService: SourceMarketFactStorageService,
    @Inject(SourceOperationsService)
    private readonly sourceOperationsService: SourceOperationsService,
    @Inject(SourcePayloadNormalizationService)
    private readonly sourcePayloadNormalizationService: SourcePayloadNormalizationService,
    @Inject(SourceProvenanceService)
    private readonly sourceProvenanceService: SourceProvenanceService,
    @Inject(OverlapAwareSourceUniverseService)
    private readonly overlapAwareSourceUniverseService: OverlapAwareSourceUniverseService,
    @Inject(ManagedMarketSourceRuntimeService)
    private readonly runtimeService: ManagedMarketSourceRuntimeService,
    @Inject(BitSkinsHttpClientService)
    private readonly bitSkinsHttpClientService: BitSkinsHttpClientService,
    @Inject(BitSkinsMarketStateService)
    private readonly bitSkinsMarketStateService: BitSkinsMarketStateService,
    @Inject(NormalizedMarketStateDeltaService)
    private readonly normalizedMarketStateDeltaService: NormalizedMarketStateDeltaService,
  ) {}

  async syncMarket(input: ManagedMarketSyncJobData): Promise<void> {
    const payload = this.serializeJson(input);
    const jobRunId = input.externalJobId
      ? await this.sourceOperationsService.startQueuedJobRun({
          source: 'bitskins',
          queueName: BITSKINS_SYNC_QUEUE_NAME,
          jobName: BITSKINS_SYNC_JOB_NAME,
          externalJobId: input.externalJobId,
          ...(payload ? { payload } : {}),
        })
      : await this.sourceOperationsService.startJobRun({
          source: 'bitskins',
          queueName: BITSKINS_SYNC_QUEUE_NAME,
          jobName: BITSKINS_SYNC_JOB_NAME,
          ...(payload ? { payload } : {}),
        });

    try {
      if (!this.configService.isBitSkinsEnabled()) {
        await this.cancelSync(jobRunId, {
          reason: 'bitskins_not_configured',
        });

        return;
      }

      const circuitBreaker =
        await this.runtimeService.checkCircuitBreaker('bitskins');

      if (!circuitBreaker.allowed) {
        await this.cancelSync(jobRunId, {
          reason: 'circuit_breaker_open',
          retryAfterSeconds: circuitBreaker.retryAfterSeconds ?? null,
          consecutiveFailures: circuitBreaker.consecutiveFailures,
        });
        await this.sourceOperationsService.recordHealthMetric({
          source: 'bitskins',
          status: HealthStatus.DEGRADED,
          details: {
            reason: 'circuit_breaker_open',
            retryAfterSeconds: circuitBreaker.retryAfterSeconds ?? null,
          } satisfies Prisma.InputJsonValue,
        });

        return;
      }

      const startedAt = new Date();
      const batches =
        await this.overlapAwareSourceUniverseService.selectPriorityBatches({
          source: 'bitskins',
          batchBudget: Math.max(
            1,
            input.batchBudget ?? this.configService.bitskinsBatchBudget,
          ),
          batchSize: Math.max(1, this.configService.bitskinsBatchSize),
          staleAfterMs: 20 * 60 * 1000,
          ...(input.targetItemVariantIds?.length
            ? { targetItemVariantIds: input.targetItemVariantIds }
            : {}),
          ...(input.force !== undefined ? { force: input.force } : {}),
        });
      const targets = this.flattenTargets(batches);

      if (targets.length === 0) {
        await this.cancelSync(jobRunId, {
          reason: 'no_overlap_candidates',
        });

        return;
      }

      await this.sourceOperationsService.upsertSyncStatus({
        source: 'bitskins',
        syncType: SyncType.LISTINGS,
        status: SyncStatus.RUNNING,
        jobRunId,
        details: {
          batchCount: batches.length,
          targetCount: targets.length,
          ingestMode: 'bounded-target-filtered-full-snapshot',
        } satisfies Prisma.InputJsonValue,
      });

      const reservation = await this.runtimeService.reserve('bitskins', 1);

      if (!reservation.granted) {
        await this.cancelSync(jobRunId, {
          reason: 'rate_limited',
          retryAfterSeconds: reservation.retryAfterSeconds ?? null,
          targetCount: targets.length,
        });
        await this.sourceOperationsService.recordHealthMetric({
          source: 'bitskins',
          status: HealthStatus.DEGRADED,
          rateLimitRemaining: 0,
          details: {
            reason: 'rate_limited',
            retryAfterSeconds: reservation.retryAfterSeconds ?? null,
          } satisfies Prisma.InputJsonValue,
        });

        return;
      }

      const requestStartedAt = Date.now();
      const snapshot = await this.bitSkinsHttpClientService.fetchMarketSnapshot();
      const observedAt = new Date();
      const archive = await this.rawPayloadArchiveService.archive({
        source: 'bitskins',
        endpointName: BITSKINS_LISTINGS_ENDPOINT_NAME,
        observedAt,
        payload: snapshot,
        jobRunId,
        externalId: 'bitskins:market:insell:730',
        requestFingerprint: this.buildRequestFingerprint(targets),
        requestMeta: {
          batchCount: batches.length,
          targetCount: targets.length,
          targetItemVariantIds: targets.map((target) => target.itemVariantId),
          targets,
          syncStartedAt: startedAt.toISOString(),
        },
        responseMeta: {
          returnedItemCount: snapshot.list.length,
        },
        contentType: 'application/json',
        httpStatus: 200,
      });
      const normalizedPayload =
        await this.sourcePayloadNormalizationService.normalizeArchivedPayload({
          rawPayloadArchiveId: archive.id,
          source: 'bitskins',
        });
      const targetItemVariantIds = targets.map((target) => target.itemVariantId);

      if (normalizedPayload.equivalentMarketStateSourceArchiveId) {
        await this.sourceListingStorageService.refreshActiveListingsHeartbeatForVariants(
          {
            source: 'bitskins',
            itemVariantIds: targetItemVariantIds,
            observedAt,
          },
        );
        const refreshedCount =
          await this.bitSkinsMarketStateService.refreshHeartbeatForVariants({
            itemVariantIds: targetItemVariantIds,
            observedAt,
            ...(normalizedPayload.normalizedAt
              ? { updatedAt: normalizedPayload.normalizedAt }
              : {}),
          });
        const result = {
          targetCount: targets.length,
          returnedItemCount: snapshot.list.length,
          matchedTargetCount: 0,
          missingTargetCount: 0,
          changedTargetCount: 0,
          unchangedTargetCount: targetItemVariantIds.length,
          equivalentPayloadSkipped: true,
          refreshedCount,
        } satisfies Prisma.InputJsonValue;

        await this.runtimeService.recordSuccess('bitskins');
        await this.sourceOperationsService.completeJobRun({
          jobRunId,
          result,
        });
        await this.sourceOperationsService.upsertSyncStatus({
          source: 'bitskins',
          syncType: SyncType.LISTINGS,
          status: SyncStatus.SUCCEEDED,
          jobRunId,
          markSuccessful: true,
          details: result,
        });
        await this.sourceOperationsService.recordHealthMetric({
          source: 'bitskins',
          status: HealthStatus.OK,
          availabilityRatio: 1,
          errorRate: 0,
          latencyMs: Date.now() - requestStartedAt,
          details: result,
        });

        return;
      }

      const changedOnlyDelta =
        await this.normalizedMarketStateDeltaService.applyChangedOnlyGate(
          normalizedPayload,
        );
      const changedVariantIds = new Set(
        changedOnlyDelta.payload.marketStates
          .map((marketState) => marketState.itemVariantId)
          .filter((itemVariantId): itemVariantId is string =>
            typeof itemVariantId === 'string' && itemVariantId.length > 0,
          ),
      );
      const payloadForPersistence = {
        ...changedOnlyDelta.payload,
        listings: normalizedPayload.listings.filter(
          (listing) =>
            typeof listing.itemVariantId === 'string' &&
            changedVariantIds.has(listing.itemVariantId),
        ),
      };
      const listingStorageResult =
        await this.sourceListingStorageService.storeNormalizedListings(
          payloadForPersistence,
        );
      const marketFactStorageResult =
        await this.sourceMarketFactStorageService.storeNormalizedMarketFacts(
          payloadForPersistence,
        );
      const pendingMappings =
        await this.pendingSourceMappingService.captureFromPayload(
          normalizedPayload,
        );

      await Promise.all([
        this.sourceProvenanceService.recordListings(
          payloadForPersistence,
          listingStorageResult,
        ),
        this.sourceProvenanceService.recordMarketFacts(
          payloadForPersistence,
          marketFactStorageResult,
        ),
        this.sourceFreshnessService.recordNormalizedPayload(normalizedPayload),
        this.sourceFetchJobService.recordNormalization(
          normalizedPayload.fetchJobId,
          listingStorageResult.storedCount + marketFactStorageResult.storedCount,
          normalizedPayload.warnings.length + pendingMappings,
        ),
      ]);

      const unchangedVariantIds = [
        ...new Set(
          changedOnlyDelta.unchangedMarketStates
            .map((marketState) => marketState.itemVariantId)
            .filter((itemVariantId): itemVariantId is string =>
              typeof itemVariantId === 'string' && itemVariantId.length > 0,
            ),
        ),
      ];
      const unchangedHeartbeatRefreshedCount =
        await this.bitSkinsMarketStateService.refreshHeartbeatForVariants({
          itemVariantIds: unchangedVariantIds,
          observedAt,
          ...(normalizedPayload.normalizedAt
            ? { updatedAt: normalizedPayload.normalizedAt }
            : {}),
        });
      const rebuildResult =
        changedVariantIds.size > 0
          ? await this.bitSkinsMarketStateService.reconcileAndRebuild({
              syncStartedAt: startedAt,
              observedAt,
              sourceListingIds: listingStorageResult.sourceListingIds,
              targetItemVariantIds: [...changedVariantIds],
            })
          : {
              removedCount: 0,
              rebuiltStateCount: 0,
            };
      const matchedTargetCount = normalizedPayload.listings.length;
      const missingTargetCount = normalizedPayload.marketStates.filter(
        (marketState) =>
          marketState.listingCount === 0 &&
          this.readTargetStatus(marketState.metadata) === 'missing_from_snapshot',
      ).length;
      const result = {
        targetCount: targets.length,
        returnedItemCount: snapshot.list.length,
        matchedTargetCount,
        missingTargetCount,
        changedTargetCount: changedVariantIds.size,
        unchangedTargetCount: unchangedVariantIds.length,
        listingsStored: listingStorageResult.storedCount,
        marketFactsStored: marketFactStorageResult.storedCount,
        removedListings: rebuildResult.removedCount,
        marketStatesRebuilt: rebuildResult.rebuiltStateCount,
        pendingMappings,
      } satisfies Prisma.InputJsonValue;

      await this.runtimeService.recordSuccess('bitskins');
      await this.sourceOperationsService.completeJobRun({
        jobRunId,
        result,
      });
      await this.sourceOperationsService.upsertSyncStatus({
        source: 'bitskins',
        syncType: SyncType.LISTINGS,
        status:
          pendingMappings > 0 || normalizedPayload.warnings.length > 0
            ? SyncStatus.DEGRADED
            : SyncStatus.SUCCEEDED,
        jobRunId,
        markSuccessful: true,
        details: result,
      });
      await this.sourceOperationsService.recordHealthMetric({
        source: 'bitskins',
        status:
          pendingMappings > 0 || normalizedPayload.warnings.length > 0
            ? HealthStatus.DEGRADED
            : HealthStatus.OK,
        availabilityRatio: 1,
        errorRate: 0,
        latencyMs: Date.now() - requestStartedAt,
        details: {
          ...result,
          unchangedHeartbeatRefreshedCount,
        } satisfies Prisma.InputJsonValue,
      });
    } catch (error) {
      await this.runtimeService.recordFailure('bitskins');
      const failureDetails = {
        error:
          error instanceof Error ? error.message : 'Unknown BitSkins error',
      } satisfies Prisma.InputJsonValue;

      await this.sourceOperationsService.failJobRun({
        jobRunId,
        errorMessage:
          error instanceof Error ? error.message : 'Unknown BitSkins error',
        result: failureDetails,
      });
      await this.sourceOperationsService.upsertSyncStatus({
        source: 'bitskins',
        syncType: SyncType.LISTINGS,
        status: SyncStatus.FAILED,
        jobRunId,
        markFailed: true,
        details: failureDetails,
      });
      await this.sourceOperationsService.recordHealthMetric({
        source: 'bitskins',
        status:
          error instanceof BitSkinsHttpError && error.statusCode === 429
            ? HealthStatus.DEGRADED
            : HealthStatus.FAILED,
        availabilityRatio: 0,
        errorRate: 1,
        ...(error instanceof BitSkinsHttpError && error.statusCode === 429
          ? { rateLimitRemaining: 0 }
          : {}),
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
      source: 'bitskins',
      syncType: SyncType.LISTINGS,
      status: SyncStatus.IDLE,
      jobRunId,
      details,
    });
  }

  private flattenTargets(
    batches: readonly {
      readonly targets: readonly {
        readonly canonicalItemId: string;
        readonly itemVariantId: string;
        readonly marketHashName: string;
        readonly priorityScore: number;
        readonly priorityReason: string;
        readonly existingSourceCount: number;
        readonly overlapSourceCodes: readonly string[];
      }[];
    }[],
  ) {
    const flattenedTargets = new Map<
      string,
      (typeof batches)[number]['targets'][number]
    >();

    for (const batch of batches) {
      for (const target of batch.targets) {
        if (!flattenedTargets.has(target.itemVariantId)) {
          flattenedTargets.set(target.itemVariantId, target);
        }
      }
    }

    return [...flattenedTargets.values()];
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

    return `bitskins:${createHash('sha256').update(fingerprintPayload).digest('hex')}`;
  }

  private readTargetStatus(metadata: unknown): string | undefined {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return undefined;
    }

    const value = (metadata as Record<string, unknown>).targetStatus;

    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : undefined;
  }

  private serializeJson(value: unknown): Prisma.InputJsonValue | null {
    if (value === undefined) {
      return null;
    }

    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
