import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';

import {
  DMARKET_SYNC_MARKET_JOB_NAME,
  DMARKET_SYNC_MARKET_QUEUE_NAME,
} from '../../domain/dmarket.constants';
import type { DMarketSyncJobData } from '../../dto/dmarket-sync.job.dto';
import { DMarketSyncService } from '../../services/dmarket-sync.service';

@Injectable()
@Processor(DMARKET_SYNC_MARKET_QUEUE_NAME)
export class DMarketSyncMarketProcessor extends WorkerHost {
  constructor(
    @Inject(DMarketSyncService)
    private readonly dmarketSyncService: DMarketSyncService,
  ) {
    super();
  }

  async process(job: Job<DMarketSyncJobData, void, string>): Promise<void> {
    if (job.name !== DMARKET_SYNC_MARKET_JOB_NAME) {
      return;
    }

    await this.dmarketSyncService.syncMarket(job.data);
  }
}
