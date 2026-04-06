import { Inject, Injectable } from '@nestjs/common';

import type { UsersUseCase } from '../application/users.use-case';
import {
  USERS_REPOSITORY,
  type UsersRepository,
} from '../domain/users.repository';
import { UsersStatusDto } from '../dto/users-status.dto';

@Injectable()
export class UsersService implements UsersUseCase {
  constructor(
    @Inject(USERS_REPOSITORY)
    private readonly usersRepository: UsersRepository,
  ) {}

  getStatus(): UsersStatusDto {
    return new UsersStatusDto(this.usersRepository.getModuleSkeleton());
  }
}
