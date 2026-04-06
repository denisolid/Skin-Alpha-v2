import { JobType, type Prisma } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import type { JobsQueue } from '../domain/jobs-queue.port';
import {
  MARKET_STATE_REBUILD_JOB_NAME,
  MARKET_STATE_REBUILD_QUEUE,
  MARKET_STATE_REBUILD_QUEUE_NAME,
  OPPORTUNITY_RESCAN_JOB_NAME,
  OPPORTUNITY_RESCAN_QUEUE,
  OPPORTUNITY_RESCAN_QUEUE_NAME,
} from '../domain/jobs-scheduler.constants';
import type { MarketStateRebuildJobData } from '../dto/market-state-rebuild.job.dto';
import type { OpportunityRescanJobData } from '../dto/opportunity-rescan.job.dto';
import { JobRunService } from './job-run.service';

@Injectable()
export class JobsMaintenanceDispatchService {
  constructor(
    @Inject(MARKET_STATE_REBUILD_QUEUE)
    private readonly marketStateRebuildQueue: JobsQueue<MarketStateRebuildJobData>,
    @Inject(OPPORTUNITY_RESCAN_QUEUE)
    private readonly opportunityRescanQueue: JobsQueue<OpportunityRescanJobData>,
    @Inject(JobRunService)
    private readonly jobRunService: JobRunService,
  ) {}

  async enqueueMarketStateRebuild(input: {
    readonly requestedAt: Date;
  }): Promise<{
    readonly jobRunId: string;
    readonly externalJobId: string;
    readonly queueJobId?: string;
  }> {
    const externalJobId = `scheduled:market-state-rebuild:${input.requestedAt.toISOString()}`;
    const payload = this.serializeJson({
      trigger: 'scheduled',
      requestedAt: input.requestedAt.toISOString(),
      externalJobId,
    } satisfies MarketStateRebuildJobData);
    const jobRunId = await this.jobRunService.ensureQueuedJobRun({
      queueName: MARKET_STATE_REBUILD_QUEUE_NAME,
      jobType: JobType.DIAGNOSTIC,
      jobName: MARKET_STATE_REBUILD_JOB_NAME,
      externalJobId,
      ...(payload ? { payload } : {}),
    });
    const job = await this.marketStateRebuildQueue.add(
      MARKET_STATE_REBUILD_JOB_NAME,
      {
        trigger: 'scheduled',
        requestedAt: input.requestedAt.toISOString(),
        externalJobId,
      },
      {
        jobId: externalJobId,
      },
    );

    return {
      jobRunId,
      externalJobId,
      ...(job.id ? { queueJobId: String(job.id) } : {}),
    };
  }

  async enqueueOpportunityRescan(input: {
    readonly requestedAt: Date;
    readonly changedStateCount: number;
    readonly updatedHotItemCount: number;
  }): Promise<{
    readonly jobRunId: string;
    readonly externalJobId: string;
    readonly queueJobId?: string;
  }> {
    const externalJobId = `scheduled:opportunity-rescan:${input.requestedAt.toISOString()}`;
    const payload = this.serializeJson({
      trigger: 'scheduled',
      requestedAt: input.requestedAt.toISOString(),
      externalJobId,
      changedStateCount: input.changedStateCount,
      updatedHotItemCount: input.updatedHotItemCount,
    } satisfies OpportunityRescanJobData);
    const jobRunId = await this.jobRunService.ensureQueuedJobRun({
      queueName: OPPORTUNITY_RESCAN_QUEUE_NAME,
      jobType: JobType.EVALUATION,
      jobName: OPPORTUNITY_RESCAN_JOB_NAME,
      externalJobId,
      ...(payload ? { payload } : {}),
    });
    const job = await this.opportunityRescanQueue.add(
      OPPORTUNITY_RESCAN_JOB_NAME,
      {
        trigger: 'scheduled',
        requestedAt: input.requestedAt.toISOString(),
        externalJobId,
        changedStateCount: input.changedStateCount,
        updatedHotItemCount: input.updatedHotItemCount,
      },
      {
        jobId: externalJobId,
      },
    );

    return {
      jobRunId,
      externalJobId,
      ...(job.id ? { queueJobId: String(job.id) } : {}),
    };
  }

  private serializeJson(value: unknown): Prisma.InputJsonValue | null {
    if (value === undefined) {
      return null;
    }

    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
