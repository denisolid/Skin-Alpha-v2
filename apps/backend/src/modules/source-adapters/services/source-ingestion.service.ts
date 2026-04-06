import { Inject, Injectable } from '@nestjs/common';

import type { SourceIngestionUseCase } from '../application/source-ingestion.use-case';
import {
  ARCHIVE_RAW_PAYLOAD_JOB_NAME,
  ARCHIVE_RAW_PAYLOAD_QUEUE,
  ARCHIVE_RAW_PAYLOAD_QUEUE_NAME,
} from '../domain/source-ingestion.constants';
import type { SourceJobQueue } from '../domain/source-job-queue.port';
import type { ArchiveRawPayloadJobData } from '../dto/archive-raw-payload.job.dto';
import type { SourceIngestionEnqueueResultDto } from '../dto/source-ingestion-enqueue-result.dto';
import type { SourceRawPayloadDto } from '../dto/source-raw-payload.dto';

@Injectable()
export class SourceIngestionService implements SourceIngestionUseCase {
  constructor(
    @Inject(ARCHIVE_RAW_PAYLOAD_QUEUE)
    private readonly archiveRawPayloadQueue: SourceJobQueue<ArchiveRawPayloadJobData>,
  ) {}

  async enqueueRawPayload(
    input: SourceRawPayloadDto,
  ): Promise<SourceIngestionEnqueueResultDto> {
    const job = await this.archiveRawPayloadQueue.add(
      ARCHIVE_RAW_PAYLOAD_JOB_NAME,
      input,
    );

    return {
      queueName: ARCHIVE_RAW_PAYLOAD_QUEUE_NAME,
      jobName: ARCHIVE_RAW_PAYLOAD_JOB_NAME,
      ...(job.id ? { jobId: job.id } : {}),
      source: input.source,
      endpointName: input.endpointName,
      observedAt: input.observedAt,
    };
  }
}
