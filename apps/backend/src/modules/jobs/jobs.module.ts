import { Module } from '@nestjs/common';

import { JobsController } from './controllers/jobs.controller';
import { JOBS_REPOSITORY } from './domain/jobs.repository';
import { JobsRepositoryAdapter } from './infrastructure/jobs.repository';
import { JobsService } from './services/jobs.service';

@Module({
  controllers: [JobsController],
  providers: [
    JobsService,
    {
      provide: JOBS_REPOSITORY,
      useClass: JobsRepositoryAdapter,
    },
  ],
})
export class JobsModule {}
