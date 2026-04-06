import { Controller, Get, Inject } from '@nestjs/common';

import { JobsStatusDto } from '../dto/jobs-status.dto';
import { JobsService } from '../services/jobs.service';

@Controller('jobs')
export class JobsController {
  constructor(@Inject(JobsService) private readonly jobsService: JobsService) {}

  @Get()
  getStatus(): JobsStatusDto {
    return this.jobsService.getStatus();
  }
}
