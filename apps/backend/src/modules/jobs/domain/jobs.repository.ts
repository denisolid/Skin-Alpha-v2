import type { ModuleSkeletonStatus } from '../../shared/module-skeleton.types';

export const JOBS_REPOSITORY = Symbol('JOBS_REPOSITORY');

export interface JobsRepository {
  getModuleSkeleton(): ModuleSkeletonStatus;
}
