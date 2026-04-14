import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { HealthStatus } from '@prisma/client';

import { AppLoggerService } from '../../../../infrastructure/logging/app-logger.service';
import type { UpdateLatestMarketStateBatchInput } from '../../../market-state/domain/market-state-write.model';
import type { MarketStateUpdateResultDto } from '../../../market-state/dto/market-state-update-result.dto';
import { MarketStateUpdaterService } from '../../../market-state/services/market-state-updater.service';
import {
  UPDATE_MARKET_STATE_JOB_NAME,
  UPDATE_MARKET_STATE_QUEUE_NAME,
} from '../../domain/source-ingestion.constants';
import type { UpdateMarketStateJobData } from '../../dto/update-market-state.job.dto';
import type { NormalizedMarketStateDto } from '../../dto/normalized-market-state.dto';
import { IngestionDiagnosticsService } from '../../services/ingestion-diagnostics.service';
import { SourceDeadLetterService } from '../../services/source-dead-letter.service';
import { SourceFailureClassifierService } from '../../services/source-failure-classifier.service';
import { SourceFreshnessService } from '../../services/source-freshness.service';

interface HydratedUpdateMarketStateJobData
  extends UpdateLatestMarketStateBatchInput {
  readonly marketStates: readonly NormalizedMarketStateDto[];
}

@Injectable()
@Processor(UPDATE_MARKET_STATE_QUEUE_NAME)
export class UpdateMarketStateProcessor extends WorkerHost {
  constructor(
    @Inject(AppLoggerService)
    private readonly logger: AppLoggerService,
    @Inject(MarketStateUpdaterService)
    private readonly marketStateUpdaterService: MarketStateUpdaterService,
    @Inject(SourceFreshnessService)
    private readonly sourceFreshnessService: SourceFreshnessService,
    @Inject(SourceFailureClassifierService)
    private readonly sourceFailureClassifierService: SourceFailureClassifierService,
    @Inject(SourceDeadLetterService)
    private readonly sourceDeadLetterService: SourceDeadLetterService,
    @Inject(IngestionDiagnosticsService)
    private readonly ingestionDiagnosticsService: IngestionDiagnosticsService,
  ) {
    super();
  }

  async process(
    job: Job<UpdateMarketStateJobData, MarketStateUpdateResultDto, string>,
  ): Promise<MarketStateUpdateResultDto> {
    if (job.name !== UPDATE_MARKET_STATE_JOB_NAME) {
      return {
        source: job.data.source,
        rawPayloadArchiveId: job.data.rawPayloadArchiveId,
        snapshotCount: 0,
        upsertedStateCount: 0,
        skippedCount: 0,
        unchangedProjectionSkipCount: 0,
      };
    }

    try {
      const normalizedJobData = this.normalizeJobData(job.data);
      const startedAt = Date.now();
      const result = await this.marketStateUpdaterService.updateLatestState(
        normalizedJobData,
      );
      await this.sourceFreshnessService.markProjectedMarketStates({
        source: normalizedJobData.source,
        marketStates: normalizedJobData.marketStates,
        updatedAt: new Date(),
      });
      await this.ingestionDiagnosticsService.recordStageMetric({
        source: normalizedJobData.source,
        stage: UPDATE_MARKET_STATE_QUEUE_NAME,
        status: result.skippedCount > 0 ? HealthStatus.DEGRADED : HealthStatus.OK,
        latencyMs: Date.now() - startedAt,
        details: {
          snapshotCount: result.snapshotCount,
          upsertedStateCount: result.upsertedStateCount,
          skippedCount: result.skippedCount,
          unchangedProjectionSkipCount: result.unchangedProjectionSkipCount,
        },
      });

      this.logger.log(
        `Wrote ${result.snapshotCount} market snapshots and ${result.upsertedStateCount} latest market states for ${result.source} (${result.rawPayloadArchiveId ?? 'no-archive-id'}); skipped ${result.skippedCount}, unchanged projection skips ${result.unchangedProjectionSkipCount}.`,
        UpdateMarketStateProcessor.name,
      );

      return result;
    } catch (error) {
      await this.sourceDeadLetterService.record({
        source: job.data.source,
        rawPayloadArchiveId: job.data.rawPayloadArchiveId,
        stage: UPDATE_MARKET_STATE_QUEUE_NAME,
        reason:
          error instanceof Error
            ? error.message
            : 'Unknown market-state projection error',
        failureClass: this.sourceFailureClassifierService.classify(error),
        payload: {
          rawPayloadArchiveId: job.data.rawPayloadArchiveId,
          marketStateCount: job.data.marketStates.length,
        },
      });
      throw error;
    }
  }

  private normalizeJobData(
    jobData: UpdateMarketStateJobData,
  ): HydratedUpdateMarketStateJobData {
    return {
      source: jobData.source,
      rawPayloadArchiveId: jobData.rawPayloadArchiveId,
      marketStates: jobData.marketStates.map((marketState, index) => ({
        ...marketState,
        capturedAt: this.normalizeCapturedAt(
          marketState.capturedAt,
          jobData.source,
          index,
          marketState.itemVariantId,
        ),
      })),
    };
  }

  private normalizeCapturedAt(
    capturedAt: Date | string,
    source: UpdateMarketStateJobData['source'],
    index: number,
    itemVariantId?: string,
  ): Date {
    if (capturedAt instanceof Date) {
      if (!Number.isNaN(capturedAt.getTime())) {
        return capturedAt;
      }

      throw new TypeError(
        this.buildInvalidCapturedAtMessage(
          source,
          index,
          itemVariantId,
          'Invalid Date instance',
        ),
      );
    }

    if (typeof capturedAt === 'string') {
      const normalizedDate = new Date(capturedAt);

      if (!Number.isNaN(normalizedDate.getTime())) {
        return normalizedDate;
      }

      throw new TypeError(
        this.buildInvalidCapturedAtMessage(
          source,
          index,
          itemVariantId,
          `Invalid ISO timestamp "${capturedAt}"`,
        ),
      );
    }

    throw new TypeError(
      this.buildInvalidCapturedAtMessage(
        source,
        index,
        itemVariantId,
        `Expected Date or ISO timestamp, received ${typeof capturedAt}`,
      ),
    );
  }

  private buildInvalidCapturedAtMessage(
    source: UpdateMarketStateJobData['source'],
    index: number,
    itemVariantId: string | undefined,
    reason: string,
  ): string {
    return `Invalid capturedAt in update-market-state job for ${source} market state #${index + 1}${itemVariantId ? ` (${itemVariantId})` : ''}: ${reason}.`;
  }
}
