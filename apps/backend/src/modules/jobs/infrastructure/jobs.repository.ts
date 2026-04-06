import { Injectable } from '@nestjs/common';

import { createModuleSkeletonStatus } from '../../shared/module-skeleton.types';
import type { JobsRepository } from '../domain/jobs.repository';

@Injectable()
export class JobsRepositoryAdapter implements JobsRepository {
  getModuleSkeleton() {
    return createModuleSkeletonStatus('jobs');
  }
}
