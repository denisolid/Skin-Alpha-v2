import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';

import {
  BACKUP_AGGREGATOR_SYNC_JOB_NAME,
  BACKUP_AGGREGATOR_SYNC_QUEUE_NAME,
} from '../../domain/backup-aggregator.constants';
import type { BackupAggregatorSyncJobData } from '../../dto/backup-aggregator.job.dto';
import { BackupAggregatorSyncService } from '../../services/backup-aggregator-sync.service';

@Injectable()
@Processor(BACKUP_AGGREGATOR_SYNC_QUEUE_NAME)
export class BackupAggregatorSyncProcessor extends WorkerHost {
  constructor(
    @Inject(BackupAggregatorSyncService)
    private readonly backupAggregatorSyncService: BackupAggregatorSyncService,
  ) {
    super();
  }

  async process(
    job: Job<BackupAggregatorSyncJobData, void, string>,
  ): Promise<void> {
    if (job.name !== BACKUP_AGGREGATOR_SYNC_JOB_NAME) {
      return;
    }

    await this.backupAggregatorSyncService.syncReferenceBatches(job.data);
  }
}
