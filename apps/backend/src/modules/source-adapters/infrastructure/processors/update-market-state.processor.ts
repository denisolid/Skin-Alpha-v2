import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';

import { AppLoggerService } from '../../../../infrastructure/logging/app-logger.service';
import type { MarketStateUpdateResultDto } from '../../../market-state/dto/market-state-update-result.dto';
import { MarketStateUpdaterService } from '../../../market-state/services/market-state-updater.service';
import {
  UPDATE_MARKET_STATE_JOB_NAME,
  UPDATE_MARKET_STATE_QUEUE_NAME,
} from '../../domain/source-ingestion.constants';
import type { UpdateMarketStateJobData } from '../../dto/update-market-state.job.dto';

@Injectable()
@Processor(UPDATE_MARKET_STATE_QUEUE_NAME)
export class UpdateMarketStateProcessor extends WorkerHost {
  constructor(
    @Inject(AppLoggerService)
    private readonly logger: AppLoggerService,
    @Inject(MarketStateUpdaterService)
    private readonly marketStateUpdaterService: MarketStateUpdaterService,
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
      };
    }

    const result = await this.marketStateUpdaterService.updateLatestState(
      job.data,
    );

    this.logger.log(
      `Wrote ${result.snapshotCount} market snapshots and ${result.upsertedStateCount} latest market states for ${result.source} (${result.rawPayloadArchiveId ?? 'no-archive-id'}); skipped ${result.skippedCount}.`,
      UpdateMarketStateProcessor.name,
    );

    return result;
  }
}
