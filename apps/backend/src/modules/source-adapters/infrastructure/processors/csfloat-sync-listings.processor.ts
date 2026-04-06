import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';

import {
  CSFLOAT_SYNC_LISTINGS_JOB_NAME,
  CSFLOAT_SYNC_LISTINGS_QUEUE_NAME,
} from '../../domain/csfloat.constants';
import type { CsFloatSyncJobData } from '../../dto/csfloat-sync.job.dto';
import { CsFloatSyncService } from '../../services/csfloat-sync.service';

@Injectable()
@Processor(CSFLOAT_SYNC_LISTINGS_QUEUE_NAME)
export class CsFloatSyncListingsProcessor extends WorkerHost {
  constructor(
    @Inject(CsFloatSyncService)
    private readonly csfloatSyncService: CsFloatSyncService,
  ) {
    super();
  }

  async process(job: Job<CsFloatSyncJobData, void, string>): Promise<void> {
    if (job.name !== CSFLOAT_SYNC_LISTINGS_JOB_NAME) {
      return;
    }

    await this.csfloatSyncService.syncListings(job.data);
  }
}
