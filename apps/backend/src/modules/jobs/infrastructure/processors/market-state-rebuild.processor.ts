import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { JobType, type Prisma } from '@prisma/client';

import { AppLoggerService } from '../../../../infrastructure/logging/app-logger.service';
import { MarketStateRebuildService } from '../../../market-state/services/market-state-rebuild.service';
import {
  MARKET_STATE_REBUILD_JOB_NAME,
  MARKET_STATE_REBUILD_QUEUE_NAME,
} from '../../domain/jobs-scheduler.constants';
import type { MarketStateRebuildJobData } from '../../dto/market-state-rebuild.job.dto';
import { JobRunService } from '../../services/job-run.service';

@Injectable()
@Processor(MARKET_STATE_REBUILD_QUEUE_NAME)
export class MarketStateRebuildProcessor extends WorkerHost {
  constructor(
    @Inject(AppLoggerService)
    private readonly logger: AppLoggerService,
    @Inject(JobRunService)
    private readonly jobRunService: JobRunService,
    @Inject(MarketStateRebuildService)
    private readonly marketStateRebuildService: MarketStateRebuildService,
  ) {
    super();
  }

  async process(
    job: Job<MarketStateRebuildJobData, unknown, string>,
  ): Promise<unknown> {
    if (job.name !== MARKET_STATE_REBUILD_JOB_NAME) {
      return null;
    }

    const payload = this.serializeJson(job.data);
    const jobRunId = await this.jobRunService.startQueuedJobRun({
      queueName: MARKET_STATE_REBUILD_QUEUE_NAME,
      jobType: JobType.DIAGNOSTIC,
      jobName: MARKET_STATE_REBUILD_JOB_NAME,
      externalJobId: job.data.externalJobId,
      ...(payload ? { payload } : {}),
    });

    try {
      const result =
        await this.marketStateRebuildService.rebuildLatestStateProjection();
      const serializedResult = this.serializeJson(result);

      await this.jobRunService.completeJobRun({
        jobRunId,
        ...(serializedResult !== null ? { result: serializedResult } : {}),
      });
      this.logger.log(
        `Completed scheduled market-state rebuild with ${result.rebuiltStateCount} rebuilt states from ${result.processedSnapshotCount} snapshots.`,
        MarketStateRebuildProcessor.name,
      );

      return result;
    } catch (error) {
      await this.jobRunService.failJobRun({
        jobRunId,
        errorMessage:
          error instanceof Error
            ? error.message
            : 'Unknown market-state rebuild error',
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
