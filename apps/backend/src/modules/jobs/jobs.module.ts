import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Module, type Provider } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import type { Queue } from 'bullmq';

import { MarketStateModule } from '../market-state/market-state.module';
import { OpportunitiesModule } from '../opportunities/opportunities.module';
import { SourceAdaptersModule } from '../source-adapters/source-adapters.module';
import { JobsController } from './controllers/jobs.controller';
import type { JobsQueue } from './domain/jobs-queue.port';
import {
  MARKET_STATE_REBUILD_QUEUE,
  MARKET_STATE_REBUILD_QUEUE_NAME,
  OPPORTUNITY_RESCAN_QUEUE,
  OPPORTUNITY_RESCAN_QUEUE_NAME,
} from './domain/jobs-scheduler.constants';
import { JOBS_REPOSITORY } from './domain/jobs.repository';
import type { MarketStateRebuildJobData } from './dto/market-state-rebuild.job.dto';
import type { OpportunityRescanJobData } from './dto/opportunity-rescan.job.dto';
import { JobsRepositoryAdapter } from './infrastructure/jobs.repository';
import { MarketStateRebuildProcessor } from './infrastructure/processors/market-state-rebuild.processor';
import { OpportunityRescanProcessor } from './infrastructure/processors/opportunity-rescan.processor';
import { NoopJobsQueue } from './infrastructure/queues/noop-jobs.queue';
import { JobRunService } from './services/job-run.service';
import { JobsMaintenanceDispatchService } from './services/jobs-maintenance-dispatch.service';
import { JobsService } from './services/jobs.service';
import { SchedulerLockService } from './services/scheduler-lock.service';
import { SmartSchedulerService } from './services/smart-scheduler.service';

const isTestEnvironment = process.env.NODE_ENV === 'test';

const jobsQueueImports = isTestEnvironment
  ? []
  : [
      BullModule.registerQueue(
        {
          name: MARKET_STATE_REBUILD_QUEUE_NAME,
          defaultJobOptions: {
            attempts: 2,
            removeOnComplete: 50,
            removeOnFail: 200,
          },
        },
        {
          name: OPPORTUNITY_RESCAN_QUEUE_NAME,
          defaultJobOptions: {
            attempts: 2,
            removeOnComplete: 50,
            removeOnFail: 200,
          },
        },
      ),
    ];

const jobsQueueProviders: Provider[] = isTestEnvironment
  ? [
      {
        provide: MARKET_STATE_REBUILD_QUEUE,
        useFactory: (): JobsQueue<MarketStateRebuildJobData> =>
          new NoopJobsQueue<MarketStateRebuildJobData>(),
      },
      {
        provide: OPPORTUNITY_RESCAN_QUEUE,
        useFactory: (): JobsQueue<OpportunityRescanJobData> =>
          new NoopJobsQueue<OpportunityRescanJobData>(),
      },
    ]
  : [
      {
        provide: MARKET_STATE_REBUILD_QUEUE,
        inject: [getQueueToken(MARKET_STATE_REBUILD_QUEUE_NAME)],
        useFactory: (
          queue: Queue<MarketStateRebuildJobData>,
        ): JobsQueue<MarketStateRebuildJobData> => queue,
      },
      {
        provide: OPPORTUNITY_RESCAN_QUEUE,
        inject: [getQueueToken(OPPORTUNITY_RESCAN_QUEUE_NAME)],
        useFactory: (
          queue: Queue<OpportunityRescanJobData>,
        ): JobsQueue<OpportunityRescanJobData> => queue,
      },
    ];

const jobsWorkerProviders: Provider[] = isTestEnvironment
  ? []
  : [MarketStateRebuildProcessor, OpportunityRescanProcessor];

@Module({
  imports: [
    ScheduleModule.forRoot(),
    SourceAdaptersModule,
    MarketStateModule,
    OpportunitiesModule,
    ...jobsQueueImports,
  ],
  controllers: [JobsController],
  providers: [
    JobsService,
    JobRunService,
    SchedulerLockService,
    JobsMaintenanceDispatchService,
    SmartSchedulerService,
    ...jobsQueueProviders,
    ...jobsWorkerProviders,
    {
      provide: JOBS_REPOSITORY,
      useClass: JobsRepositoryAdapter,
    },
  ],
})
export class JobsModule {}
