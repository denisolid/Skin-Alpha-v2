import type { ModuleSkeletonStatus } from '../../shared/module-skeleton.types';

export const USERS_REPOSITORY = Symbol('USERS_REPOSITORY');

export interface UsersRepository {
  getModuleSkeleton(): ModuleSkeletonStatus;
}
