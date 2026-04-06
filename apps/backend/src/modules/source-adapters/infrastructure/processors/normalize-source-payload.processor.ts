import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';

import { AppLoggerService } from '../../../../infrastructure/logging/app-logger.service';
import {
  NORMALIZE_SOURCE_PAYLOAD_JOB_NAME,
  NORMALIZE_SOURCE_PAYLOAD_QUEUE_NAME,
  UPDATE_MARKET_STATE_JOB_NAME,
  UPDATE_MARKET_STATE_QUEUE,
} from '../../domain/source-ingestion.constants';
import type { SourceJobQueue } from '../../domain/source-job-queue.port';
import type { NormalizeSourcePayloadJobData } from '../../dto/normalize-source-payload.job.dto';
import type { UpdateMarketStateJobData } from '../../dto/update-market-state.job.dto';
import { SourceListingStorageService } from '../../services/source-listing-storage.service';
import { SourcePayloadNormalizationService } from '../../services/source-payload-normalization.service';

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
      const normalizedPayload =
        await this.sourcePayloadNormalizationService.normalizeArchivedPayload(
          job.data,
        );
      const listingStorageResult =
        await this.sourceListingStorageService.storeNormalizedListings(
          normalizedPayload,
        );

      this.logger.log(
        `Normalized ${normalizedPayload.source}:${normalizedPayload.endpointName} (${normalizedPayload.rawPayloadArchiveId}) with ${normalizedPayload.listings.length} extracted listings, ${normalizedPayload.marketStates.length} extracted market states, ${listingStorageResult.storedCount} persisted listings, and ${listingStorageResult.skippedCount} skipped listings.`,
        NormalizeSourcePayloadProcessor.name,
      );

      await this.updateMarketStateQueue.add(
        UPDATE_MARKET_STATE_JOB_NAME,
        {
          rawPayloadArchiveId: normalizedPayload.rawPayloadArchiveId,
          source: normalizedPayload.source,
          marketStates: normalizedPayload.marketStates,
        },
        {
          jobId: `${normalizedPayload.rawPayloadArchiveId}-market-state`,
        },
      );

      return {
        rawPayloadArchiveId: normalizedPayload.rawPayloadArchiveId,
        storedCount: listingStorageResult.storedCount,
        skippedCount: listingStorageResult.skippedCount,
      };
    } catch (error) {
      this.logger.error(
        `Normalization processor failed for archive ${job.data.rawPayloadArchiveId}: ${error instanceof Error ? error.message : 'Unknown normalization processor error'}`,
        error instanceof Error ? error.stack : undefined,
        NormalizeSourcePayloadProcessor.name,
      );
      throw error;
    }
  }
}
