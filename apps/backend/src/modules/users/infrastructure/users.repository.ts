import { Injectable } from '@nestjs/common';

import { createModuleSkeletonStatus } from '../../shared/module-skeleton.types';
import type { UsersRepository } from '../domain/users.repository';

@Injectable()
export class UsersRepositoryAdapter implements UsersRepository {
  getModuleSkeleton() {
    return createModuleSkeletonStatus('users');
  }
}
