import { Inject, Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../infrastructure/config/app-config.service';
import {
  HEALTH_REPOSITORY,
  type HealthRepository,
} from '../domain/health.repository';
import { HealthStatusDto } from '../dto/health-status.dto';
import type { HealthUseCase } from '../application/health.use-case';

@Injectable()
export class HealthService implements HealthUseCase {
  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
    @Inject(HEALTH_REPOSITORY)
    private readonly healthRepository: HealthRepository,
  ) {}

  getHealth(): HealthStatusDto {
    return new HealthStatusDto({
      name: this.configService.appName,
      environment: this.configService.nodeEnv,
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: this.healthRepository.getDependencies(),
    });
  }
}
