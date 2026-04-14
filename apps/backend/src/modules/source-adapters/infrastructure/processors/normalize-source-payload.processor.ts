import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';

import { AppLoggerService } from '../../../../infrastructure/logging/app-logger.service';
import { HealthStatus } from '@prisma/client';
import { MarketStateUpdaterService } from '../../../market-state/services/market-state-updater.service';
import {
  NORMALIZE_SOURCE_PAYLOAD_JOB_NAME,
  NORMALIZE_SOURCE_PAYLOAD_QUEUE_NAME,
  UPDATE_MARKET_STATE_JOB_NAME,
  UPDATE_MARKET_STATE_QUEUE,
} from '../../domain/source-ingestion.constants';
import type { SourceJobQueue } from '../../domain/source-job-queue.port';
import type { NormalizeSourcePayloadJobData } from '../../dto/normalize-source-payload.job.dto';
import type { NormalizedMarketStateDto } from '../../dto/normalized-market-state.dto';
import type { UpdateMarketStateJobData } from '../../dto/update-market-state.job.dto';
import { IngestionDiagnosticsService } from '../../services/ingestion-diagnostics.service';
import { PendingSourceMappingService } from '../../services/pending-source-mapping.service';
import { SourceDeadLetterService } from '../../services/source-dead-letter.service';
import { SourceFailureClassifierService } from '../../services/source-failure-classifier.service';
import { SourceFetchJobService } from '../../services/source-fetch-job.service';
import { SourceFreshnessService } from '../../services/source-freshness.service';
import { SourceListingStorageService } from '../../services/source-listing-storage.service';
import { SourceMarketFactStorageService } from '../../services/source-market-fact-storage.service';
import { NormalizedMarketStateDeltaService } from '../../services/normalized-market-state-delta.service';
import { SourcePayloadNormalizationService } from '../../services/source-payload-normalization.service';
import { SourceProvenanceService } from '../../services/source-provenance.service';

const MARKET_STATE_JOB_CHUNK_SIZE = 500;

@Injectable()
@Processor(NORMALIZE_SOURCE_PAYLOAD_QUEUE_NAME)
export class NormalizeSourcePayloadProcessor extends WorkerHost {
  constructor(
    @Inject(AppLoggerService)
    private readonly logger: AppLoggerService,
    @Inject(SourcePayloadNormalizationService)
    private readonly sourcePayloadNormalizationService: SourcePayloadNormalizationService,
    @Inject(SourceListingStorageService)
    private readonly sourceListingStorageService: SourceListingStorageService,
    @Inject(SourceMarketFactStorageService)
    private readonly sourceMarketFactStorageService: SourceMarketFactStorageService,
    @Inject(NormalizedMarketStateDeltaService)
    private readonly normalizedMarketStateDeltaService: NormalizedMarketStateDeltaService,
    @Inject(PendingSourceMappingService)
    private readonly pendingSourceMappingService: PendingSourceMappingService,
    @Inject(SourceProvenanceService)
    private readonly sourceProvenanceService: SourceProvenanceService,
    @Inject(SourceFreshnessService)
    private readonly sourceFreshnessService: SourceFreshnessService,
    @Inject(MarketStateUpdaterService)
    private readonly marketStateUpdaterService: MarketStateUpdaterService,
    @Inject(SourceFetchJobService)
    private readonly sourceFetchJobService: SourceFetchJobService,
    @Inject(SourceFailureClassifierService)
    private readonly sourceFailureClassifierService: SourceFailureClassifierService,
    @Inject(SourceDeadLetterService)
    private readonly sourceDeadLetterService: SourceDeadLetterService,
    @Inject(IngestionDiagnosticsService)
    private readonly ingestionDiagnosticsService: IngestionDiagnosticsService,
    @Inject(UPDATE_MARKET_STATE_QUEUE)
    private readonly updateMarketStateQueue: SourceJobQueue<UpdateMarketStateJobData>,
  ) {
    super();
  }

  async process(
    job: Job<
      NormalizeSourcePayloadJobData,
      {
        rawPayloadArchiveId: string;
        storedCount: number;
        skippedCount: number;
      },
      string
    >,
  ): Promise<{
    rawPayloadArchiveId: string;
    storedCount: number;
    skippedCount: number;
  }> {
    if (job.name !== NORMALIZE_SOURCE_PAYLOAD_JOB_NAME) {
      return {
        rawPayloadArchiveId: job.data.rawPayloadArchiveId,
        storedCount: 0,
        skippedCount: 0,
      };
    }

    try {
      const startedAt = Date.now();
      const normalizedPayload =
        await this.sourcePayloadNormalizationService.normalizeArchivedPayload(
          job.data,
        );
      const changedOnlyDelta =
        await this.normalizedMarketStateDeltaService.applyChangedOnlyGate(
          normalizedPayload,
        );
      const payloadForPersistence = changedOnlyDelta.payload;
      const heartbeatRefreshedCount =
        payloadForPersistence.equivalentMarketStateSourceArchiveId
          ? await this.marketStateUpdaterService.refreshLatestStateHeartbeat({
              source: payloadForPersistence.source,
              equivalentRawPayloadArchiveId:
                payloadForPersistence.equivalentMarketStateSourceArchiveId,
              observedAt: payloadForPersistence.observedAt,
              rawPayloadArchiveId: payloadForPersistence.rawPayloadArchiveId,
            })
          : 0;
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
          payloadForPersistence,
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
        payloadForPersistence.equivalentMarketStateSourceArchiveId
          ? this.sourceFreshnessService.refreshMarketStateHeartbeatFromEquivalentArchive(
              {
                source: payloadForPersistence.source,
                equivalentRawPayloadArchiveId:
                  payloadForPersistence.equivalentMarketStateSourceArchiveId,
                observedAt: payloadForPersistence.observedAt,
                ...(payloadForPersistence.normalizedAt
                  ? { normalizedAt: payloadForPersistence.normalizedAt }
                  : {}),
              },
            )
          : Promise.resolve(0),
        this.sourceFetchJobService.recordNormalization(
          payloadForPersistence.fetchJobId,
          listingStorageResult.storedCount + marketFactStorageResult.storedCount,
          payloadForPersistence.warnings.length + pendingMappings,
        ),
      ]);
      const itemScopedHeartbeatRefreshedCount =
        await this.refreshItemScopedMarketStateHeartbeats(
          changedOnlyDelta.unchangedMarketStates,
          payloadForPersistence,
        );

      this.logger.log(
        `Normalized ${payloadForPersistence.source}:${payloadForPersistence.endpointName} (${payloadForPersistence.rawPayloadArchiveId}) with ${normalizedPayload.listings.length} extracted listings, ${normalizedPayload.marketStates.length} extracted market states, ${listingStorageResult.storedCount} persisted listings, ${marketFactStorageResult.storedCount} persisted market facts, ${heartbeatRefreshedCount} archive-heartbeat-refreshed states, ${itemScopedHeartbeatRefreshedCount} item-heartbeat-refreshed states, ${changedOnlyDelta.unchangedMarketStateCount} changed-only market-state skips, ${pendingMappings} pending mappings, and ${listingStorageResult.skippedCount + marketFactStorageResult.skippedCount} skipped entities.`,
        NormalizeSourcePayloadProcessor.name,
      );
      await this.ingestionDiagnosticsService.recordStageMetric({
        source: payloadForPersistence.source,
        stage: NORMALIZE_SOURCE_PAYLOAD_QUEUE_NAME,
        status:
          (payloadForPersistence.warnings.length > 0 &&
            !this.hasOnlyBenignSkipWarnings(payloadForPersistence.warnings)) ||
          pendingMappings > 0
            ? HealthStatus.DEGRADED
            : HealthStatus.OK,
        latencyMs: Date.now() - startedAt,
        details: {
          listingsExtracted: normalizedPayload.listings.length,
          marketStatesExtracted: normalizedPayload.marketStates.length,
          marketStatesChangedOnlyStored: payloadForPersistence.marketStates.length,
          marketStatesChangedOnlySkipped:
            changedOnlyDelta.unchangedMarketStateCount,
          listingsStored: listingStorageResult.storedCount,
          marketFactsStored: marketFactStorageResult.storedCount,
          pendingMappings,
          warnings: payloadForPersistence.warnings.length,
          unchangedPayloadSkipped:
            payloadForPersistence.warnings.length > 0 &&
            this.hasOnlyBenignSkipWarnings(payloadForPersistence.warnings),
          marketStateJobsEnqueued:
            payloadForPersistence.marketStates.length === 0
              ? 0
              : Math.ceil(
                  payloadForPersistence.marketStates.length /
                    MARKET_STATE_JOB_CHUNK_SIZE,
                ),
          marketStateHeartbeatRefreshedCount: heartbeatRefreshedCount,
          itemScopedMarketStateHeartbeatRefreshedCount:
            itemScopedHeartbeatRefreshedCount,
        },
      });

      await this.enqueueMarketStateJobs(payloadForPersistence);

      return {
        rawPayloadArchiveId: payloadForPersistence.rawPayloadArchiveId,
        storedCount: listingStorageResult.storedCount,
        skippedCount: listingStorageResult.skippedCount,
      };
    } catch (error) {
      this.logger.error(
        `Normalization processor failed for archive ${job.data.rawPayloadArchiveId}: ${error instanceof Error ? error.message : 'Unknown normalization processor error'}`,
        error instanceof Error ? error.stack : undefined,
        NormalizeSourcePayloadProcessor.name,
      );
      await this.sourceDeadLetterService.record({
        source: job.data.source,
        rawPayloadArchiveId: job.data.rawPayloadArchiveId,
        stage: NORMALIZE_SOURCE_PAYLOAD_QUEUE_NAME,
        reason:
          error instanceof Error
            ? error.message
            : 'Unknown normalization processor error',
        failureClass: this.sourceFailureClassifierService.classify(error),
        payload: {
          rawPayloadArchiveId: job.data.rawPayloadArchiveId,
          source: job.data.source,
        },
      });
      throw error;
    }
  }

  private async enqueueMarketStateJobs(
    normalizedPayload: Awaited<
      ReturnType<SourcePayloadNormalizationService['normalizeArchivedPayload']>
    >,
  ): Promise<void> {
    if (normalizedPayload.marketStates.length === 0) {
      return;
    }

    const marketStateChunks = this.chunkMarketStates(
      normalizedPayload.marketStates,
      MARKET_STATE_JOB_CHUNK_SIZE,
    );

    for (const [index, marketStates] of marketStateChunks.entries()) {
      await this.updateMarketStateQueue.add(
        UPDATE_MARKET_STATE_JOB_NAME,
        {
          rawPayloadArchiveId: normalizedPayload.rawPayloadArchiveId,
          source: normalizedPayload.source,
          marketStates,
        },
        {
          jobId:
            marketStateChunks.length === 1
              ? `${normalizedPayload.rawPayloadArchiveId}-market-state`
              : `${normalizedPayload.rawPayloadArchiveId}-market-state-${index + 1}`,
        },
      );
    }
  }

  private chunkMarketStates(
    marketStates: UpdateMarketStateJobData['marketStates'],
    chunkSize: number,
  ): UpdateMarketStateJobData['marketStates'][] {
    if (marketStates.length <= chunkSize) {
      return [marketStates];
    }

    const chunks: UpdateMarketStateJobData['marketStates'][] = [];

    for (let index = 0; index < marketStates.length; index += chunkSize) {
      chunks.push(marketStates.slice(index, index + chunkSize));
    }

    return chunks;
  }

  private async refreshItemScopedMarketStateHeartbeats(
    unchangedMarketStates: readonly NormalizedMarketStateDto[],
    normalizedPayload: Awaited<
      ReturnType<SourcePayloadNormalizationService['normalizeArchivedPayload']>
    >,
  ): Promise<number> {
    if (unchangedMarketStates.length === 0) {
      return 0;
    }

    const groupedVariantIds = new Map<string, string[]>();

    for (const marketState of unchangedMarketStates) {
      if (!marketState.itemVariantId) {
        continue;
      }

      const groupKey = marketState.capturedAt.toISOString();
      const group = groupedVariantIds.get(groupKey) ?? [];

      group.push(marketState.itemVariantId);
      groupedVariantIds.set(groupKey, group);
    }

    let refreshedCount = 0;

    for (const [capturedAtIso, itemVariantIds] of groupedVariantIds.entries()) {
      const capturedAt = new Date(capturedAtIso);

      refreshedCount +=
        await this.marketStateUpdaterService.refreshLatestStateHeartbeatForVariants(
          {
            source: normalizedPayload.source,
            itemVariantIds,
            observedAt: capturedAt,
            rawPayloadArchiveId: normalizedPayload.rawPayloadArchiveId,
          },
        );
      await this.sourceFreshnessService.refreshProjectedMarketStatesHeartbeatForVariants(
        {
          source: normalizedPayload.source,
          itemVariantIds,
          observedAt: capturedAt,
          ...(normalizedPayload.normalizedAt
            ? { updatedAt: normalizedPayload.normalizedAt }
            : {}),
        },
      );
    }

    return refreshedCount;
  }

  private hasOnlyBenignSkipWarnings(warnings: readonly string[]): boolean {
    return (
      warnings.length > 0 &&
      warnings.every((warning) => warning.startsWith('Skipped unchanged '))
    );
  }
}
