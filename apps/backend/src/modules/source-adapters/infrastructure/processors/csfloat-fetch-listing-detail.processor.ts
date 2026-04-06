import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';

import {
  CSFLOAT_FETCH_LISTING_DETAIL_JOB_NAME,
  CSFLOAT_FETCH_LISTING_DETAIL_QUEUE_NAME,
} from '../../domain/csfloat.constants';
import type { CsFloatListingDetailJobData } from '../../dto/csfloat-sync.job.dto';
import { CsFloatSyncService } from '../../services/csfloat-sync.service';

@Injectable()
@Processor(CSFLOAT_FETCH_LISTING_DETAIL_QUEUE_NAME)
export class CsFloatFetchListingDetailProcessor extends WorkerHost {
  constructor(
    @Inject(CsFloatSyncService)
    private readonly csfloatSyncService: CsFloatSyncService,
  ) {
    super();
  }

  async process(
    job: Job<CsFloatListingDetailJobData, void, string>,
  ): Promise<void> {
    if (job.name !== CSFLOAT_FETCH_LISTING_DETAIL_JOB_NAME) {
      return;
    }

    await this.csfloatSyncService.syncListingDetail(job.data);
  }
}
