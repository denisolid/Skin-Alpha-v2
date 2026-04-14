import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';

import {
  WAXPEER_SYNC_MARKET_JOB_NAME,
  WAXPEER_SYNC_MARKET_QUEUE_NAME,
} from '../../domain/waxpeer.constants';
import type { WaxpeerSyncJobData } from '../../dto/waxpeer-sync.job.dto';
import { WaxpeerSyncService } from '../../services/waxpeer-sync.service';

@Injectable()
@Processor(WAXPEER_SYNC_MARKET_QUEUE_NAME)
export class WaxpeerSyncMarketProcessor extends WorkerHost {
  constructor(
    @Inject(WaxpeerSyncService)
    private readonly waxpeerSyncService: WaxpeerSyncService,
  ) {
    super();
  }

  async process(job: Job<WaxpeerSyncJobData, void, string>): Promise<void> {
    if (job.name !== WAXPEER_SYNC_MARKET_JOB_NAME) {
      return;
    }

    await this.waxpeerSyncService.syncMarket(job.data);
  }
}
