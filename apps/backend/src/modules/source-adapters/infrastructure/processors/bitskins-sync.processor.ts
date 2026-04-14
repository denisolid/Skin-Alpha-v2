import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';

import {
  BITSKINS_SYNC_JOB_NAME,
  BITSKINS_SYNC_QUEUE_NAME,
} from '../../domain/managed-market.constants';
import type { ManagedMarketSyncJobData } from '../../domain/managed-market-source.types';
import { BitSkinsSyncService } from '../../services/bitskins-sync.service';

@Injectable()
@Processor(BITSKINS_SYNC_QUEUE_NAME)
export class BitSkinsSyncProcessor extends WorkerHost {
  constructor(
    @Inject(BitSkinsSyncService)
    private readonly bitSkinsSyncService: BitSkinsSyncService,
  ) {
    super();
  }

  async process(job: Job<ManagedMarketSyncJobData, void, string>): Promise<void> {
    if (job.name !== BITSKINS_SYNC_JOB_NAME) {
      return;
    }

    await this.bitSkinsSyncService.syncMarket(job.data);
  }
}
