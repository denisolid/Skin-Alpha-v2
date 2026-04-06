import { Inject, Injectable } from '@nestjs/common';

import type { JobsUseCase } from '../application/jobs.use-case';
import {
  JOBS_REPOSITORY,
  type JobsRepository,
} from '../domain/jobs.repository';
import { JobsStatusDto } from '../dto/jobs-status.dto';

@Injectable()
export class JobsService implements JobsUseCase {
  constructor(
    @Inject(JOBS_REPOSITORY)
    private readonly jobsRepository: JobsRepository,
  ) {}

  getStatus(): JobsStatusDto {
    return new JobsStatusDto(this.jobsRepository.getModuleSkeleton());
  }
}
