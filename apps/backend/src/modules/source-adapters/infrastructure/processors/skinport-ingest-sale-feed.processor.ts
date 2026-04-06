import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';

import {
  SKINPORT_INGEST_SALE_FEED_JOB_NAME,
  SKINPORT_INGEST_SALE_FEED_QUEUE_NAME,
} from '../../domain/skinport.constants';
import type { SkinportSaleFeedJobData } from '../../dto/skinport-sync.job.dto';
import { SkinportSyncService } from '../../services/skinport-sync.service';

@Injectable()
@Processor(SKINPORT_INGEST_SALE_FEED_QUEUE_NAME)
export class SkinportIngestSaleFeedProcessor extends WorkerHost {
  constructor(
    @Inject(SkinportSyncService)
    private readonly skinportSyncService: SkinportSyncService,
  ) {
    super();
  }

  async process(
    job: Job<SkinportSaleFeedJobData, void, string>,
  ): Promise<void> {
    if (job.name !== SKINPORT_INGEST_SALE_FEED_JOB_NAME) {
      return;
    }

    await this.skinportSyncService.ingestSaleFeedPayload(
      job.data.payload.payload,
      new Date(job.data.observedAt),
    );
  }
}
