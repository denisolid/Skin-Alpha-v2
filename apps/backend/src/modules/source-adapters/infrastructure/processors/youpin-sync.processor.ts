import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';

import {
  YOUPIN_SYNC_JOB_NAME,
  YOUPIN_SYNC_QUEUE_NAME,
} from '../../domain/managed-market.constants';
import type { ManagedMarketSyncJobData } from '../../domain/managed-market-source.types';
import { ManagedMarketSyncService } from '../../services/managed-market-sync.service';

@Injectable()
@Processor(YOUPIN_SYNC_QUEUE_NAME)
export class YouPinSyncProcessor extends WorkerHost {
  constructor(
    @Inject(ManagedMarketSyncService)
    private readonly managedMarketSyncService: ManagedMarketSyncService,
  ) {
    super();
  }

  async process(job: Job<ManagedMarketSyncJobData>): Promise<void> {
    if (job.name !== YOUPIN_SYNC_JOB_NAME) {
      return;
    }

    await this.managedMarketSyncService.syncSource('youpin', job.data);
  }
}
