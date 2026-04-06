import { Controller, Get, Inject } from '@nestjs/common';

import { HealthStatusDto } from '../dto/health-status.dto';
import { HealthService } from '../services/health.service';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(HealthService) private readonly healthService: HealthService,
  ) {}

  @Get()
  getHealth(): HealthStatusDto {
    return this.healthService.getHealth();
  }
}
