import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';

import {
  SKINPORT_SYNC_ITEMS_JOB_NAME,
  SKINPORT_SYNC_ITEMS_QUEUE_NAME,
} from '../../domain/skinport.constants';
import type { SkinportSyncJobData } from '../../dto/skinport-sync.job.dto';
import { SkinportSyncService } from '../../services/skinport-sync.service';

@Injectable()
@Processor(SKINPORT_SYNC_ITEMS_QUEUE_NAME)
export class SkinportSyncItemsProcessor extends WorkerHost {
  constructor(
    @Inject(SkinportSyncService)
    private readonly skinportSyncService: SkinportSyncService,
  ) {
    super();
  }

  async process(job: Job<SkinportSyncJobData, void, string>): Promise<void> {
    if (job.name !== SKINPORT_SYNC_ITEMS_JOB_NAME) {
      return;
    }

    await this.skinportSyncService.syncItemsSnapshot(job.data);
  }
}
