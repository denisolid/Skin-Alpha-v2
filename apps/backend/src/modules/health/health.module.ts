import { Module } from '@nestjs/common';

import { HealthController } from './controllers/health.controller';
import { HEALTH_REPOSITORY } from './domain/health.repository';
import { HealthRepositoryAdapter } from './infrastructure/health.repository';
import { HealthService } from './services/health.service';

@Module({
  controllers: [HealthController],
  providers: [
    HealthService,
    {
      provide: HEALTH_REPOSITORY,
      useClass: HealthRepositoryAdapter,
    },
  ],
})
export class HealthModule {}
