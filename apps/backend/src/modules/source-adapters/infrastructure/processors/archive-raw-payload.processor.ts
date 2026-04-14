import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { HealthStatus } from '@prisma/client';

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
import { IngestionDiagnosticsService } from '../../services/ingestion-diagnostics.service';
import { RawPayloadArchiveService } from '../../services/raw-payload-archive.service';
import { SourceDeadLetterService } from '../../services/source-dead-letter.service';
import { SourceFailureClassifierService } from '../../services/source-failure-classifier.service';

@Injectable()
@Processor(ARCHIVE_RAW_PAYLOAD_QUEUE_NAME)
export class ArchiveRawPayloadProcessor extends WorkerHost {
  constructor(
    @Inject(AppLoggerService)
    private readonly logger: AppLoggerService,
    @Inject(RawPayloadArchiveService)
    private readonly rawPayloadArchiveService: RawPayloadArchiveService,
    @Inject(SourceFailureClassifierService)
    private readonly sourceFailureClassifierService: SourceFailureClassifierService,
    @Inject(SourceDeadLetterService)
    private readonly sourceDeadLetterService: SourceDeadLetterService,
    @Inject(IngestionDiagnosticsService)
    private readonly ingestionDiagnosticsService: IngestionDiagnosticsService,
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

    try {
      const startedAt = Date.now();
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
        this.buildNormalizationJobOptions(archive),
      );
      await this.ingestionDiagnosticsService.recordStageMetric({
        source: archive.source,
        stage: ARCHIVE_RAW_PAYLOAD_QUEUE_NAME,
        status: HealthStatus.OK,
        latencyMs: Date.now() - startedAt,
        details: {
          endpointName: archive.endpointName,
          payloadHash: archive.payloadHash,
        },
      });

      return {
        archiveId: archive.id,
      };
    } catch (error) {
      await this.sourceDeadLetterService.record({
        source: job.data.source,
        stage: ARCHIVE_RAW_PAYLOAD_QUEUE_NAME,
        reason:
          error instanceof Error ? error.message : 'Unknown raw archive error',
        failureClass: this.sourceFailureClassifierService.classify(error),
        payload: {
          source: job.data.source,
          endpointName: job.data.endpointName,
        },
        ...(job.data.jobRunId ? { jobRunId: job.data.jobRunId } : {}),
        ...(job.data.fetchJobId ? { fetchJobId: job.data.fetchJobId } : {}),
      });
      throw error;
    }
  }

  private buildNormalizationJobOptions(archive: {
    readonly id: string;
    readonly source: string;
    readonly endpointName: string;
  }) {
    const priority =
      archive.source === 'skinport' &&
      archive.endpointName === 'skinport-sales-history'
        ? 1
        : archive.source === 'skinport' &&
            archive.endpointName === 'skinport-items-snapshot'
          ? 10
          : undefined;

    return {
      jobId: `${archive.id}-normalize`,
      ...(priority !== undefined ? { priority } : {}),
    };
  }
}
