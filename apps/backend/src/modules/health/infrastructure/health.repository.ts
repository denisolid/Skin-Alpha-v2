import { Injectable } from '@nestjs/common';

import type {
  HealthDependencies,
  HealthRepository,
} from '../domain/health.repository';

@Injectable()
export class HealthRepositoryAdapter implements HealthRepository {
  getDependencies(): HealthDependencies {
    return {
      config: 'configured',
      database: 'configured',
      queue: 'configured',
      redis: 'configured',
    };
  }
}
