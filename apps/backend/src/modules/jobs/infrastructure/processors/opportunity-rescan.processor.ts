import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { JobType, type Prisma } from '@prisma/client';

import { AppLoggerService } from '../../../../infrastructure/logging/app-logger.service';
import { OpportunityRescanService } from '../../../opportunities/services/opportunity-rescan.service';
import {
  OPPORTUNITY_RESCAN_JOB_NAME,
  OPPORTUNITY_RESCAN_QUEUE_NAME,
} from '../../domain/jobs-scheduler.constants';
import type { OpportunityRescanJobData } from '../../dto/opportunity-rescan.job.dto';
import { JobRunService } from '../../services/job-run.service';

@Injectable()
@Processor(OPPORTUNITY_RESCAN_QUEUE_NAME)
export class OpportunityRescanProcessor extends WorkerHost {
  constructor(
    @Inject(AppLoggerService)
    private readonly logger: AppLoggerService,
    @Inject(JobRunService)
    private readonly jobRunService: JobRunService,
    @Inject(OpportunityRescanService)
    private readonly opportunityRescanService: OpportunityRescanService,
  ) {
    super();
  }

  async process(
    job: Job<OpportunityRescanJobData, unknown, string>,
  ): Promise<unknown> {
    if (job.name !== OPPORTUNITY_RESCAN_JOB_NAME) {
      return null;
    }

    const payload = this.serializeJson(job.data);
    const jobRunId = await this.jobRunService.startQueuedJobRun({
      queueName: OPPORTUNITY_RESCAN_QUEUE_NAME,
      jobType: JobType.EVALUATION,
      jobName: OPPORTUNITY_RESCAN_JOB_NAME,
      externalJobId: job.data.externalJobId,
      ...(payload ? { payload } : {}),
    });

    try {
      const result = await this.opportunityRescanService.rescanAndPersist();
      const serializedResult = this.serializeJson({
        ...result,
        requestedAt: job.data.requestedAt,
        changedStateCount: job.data.changedStateCount,
        updatedHotItemCount: job.data.updatedHotItemCount,
      });

      await this.jobRunService.completeJobRun({
        jobRunId,
        ...(serializedResult !== null ? { result: serializedResult } : {}),
      });
      this.logger.log(
        `Completed scheduled opportunity rescan with ${result.persistedOpportunityCount} persisted opportunities from ${result.evaluatedPairCount} evaluated pairs.`,
        OpportunityRescanProcessor.name,
      );

      return result;
    } catch (error) {
      await this.jobRunService.failJobRun({
        jobRunId,
        errorMessage:
          error instanceof Error
            ? error.message
            : 'Unknown opportunity rescan error',
      });
      throw error;
    }
  }

  private serializeJson(value: unknown): Prisma.InputJsonValue | null {
    if (value === undefined) {
      return null;
    }

    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
