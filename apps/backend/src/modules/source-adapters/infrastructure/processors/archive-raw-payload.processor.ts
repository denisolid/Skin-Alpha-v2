import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';

import { AppLoggerService } from '../../../../infrastructure/logging/app-logger.service';
import {
  ARCHIVE_RAW_PAYLOAD_JOB_NAME,
  ARCHIVE_RAW_PAYLOAD_QUEUE_NAME,
  NORMALIZE_SOURCE_PAYLOAD_JOB_NAME,
  NORMALIZE_SOURCE_PAYLOAD_QUEUE,
} from '../../domain/source-ingestion.constants';
import type { SourceJobQueue } from '../../domain/source-job-queue.port';
import type { ArchiveRawPayloadJobData } from '../../dto/archive-raw-payload.job.dto';
import type { NormalizeSourcePayloadJobData } from '../../dto/normalize-source-payload.job.dto';
import { RawPayloadArchiveService } from '../../services/raw-payload-archive.service';

@Injectable()
@Processor(ARCHIVE_RAW_PAYLOAD_QUEUE_NAME)
export class ArchiveRawPayloadProcessor extends WorkerHost {
  constructor(
    @Inject(AppLoggerService)
    private readonly logger: AppLoggerService,
    @Inject(RawPayloadArchiveService)
    private readonly rawPayloadArchiveService: RawPayloadArchiveService,
    @Inject(NORMALIZE_SOURCE_PAYLOAD_QUEUE)
    private readonly normalizeSourcePayloadQueue: SourceJobQueue<NormalizeSourcePayloadJobData>,
  ) {
    super();
  }

  async process(
    job: Job<ArchiveRawPayloadJobData, { archiveId: string }, string>,
  ): Promise<{ archiveId: string }> {
    if (job.name !== ARCHIVE_RAW_PAYLOAD_JOB_NAME) {
      return {
        archiveId: '',
      };
    }

    const archive = await this.rawPayloadArchiveService.archive(job.data);
    this.logger.log(
      `Queued normalization for archived payload ${archive.id} from ${archive.source}:${archive.endpointName}.`,
      ArchiveRawPayloadProcessor.name,
    );

    await this.normalizeSourcePayloadQueue.add(
      NORMALIZE_SOURCE_PAYLOAD_JOB_NAME,
      {
        rawPayloadArchiveId: archive.id,
        source: archive.source,
      },
      {
        jobId: `${archive.id}-normalize`,
      },
    );

    return {
      archiveId: archive.id,
    };
  }
}
