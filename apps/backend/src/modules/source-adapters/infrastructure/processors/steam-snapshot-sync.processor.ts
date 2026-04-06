import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';

import {
  STEAM_SNAPSHOT_SYNC_JOB_NAME,
  STEAM_SNAPSHOT_SYNC_QUEUE_NAME,
} from '../../domain/steam-snapshot.constants';
import type { SteamSnapshotSyncJobData } from '../../dto/steam-snapshot.job.dto';
import { SteamSnapshotSyncService } from '../../services/steam-snapshot-sync.service';

@Injectable()
@Processor(STEAM_SNAPSHOT_SYNC_QUEUE_NAME)
export class SteamSnapshotSyncProcessor extends WorkerHost {
  constructor(
    @Inject(SteamSnapshotSyncService)
    private readonly steamSnapshotSyncService: SteamSnapshotSyncService,
  ) {
    super();
  }

  async process(
    job: Job<SteamSnapshotSyncJobData, void, string>,
  ): Promise<void> {
    if (job.name !== STEAM_SNAPSHOT_SYNC_JOB_NAME) {
      return;
    }

    await this.steamSnapshotSyncService.syncPriorityBatches(job.data);
  }
}
