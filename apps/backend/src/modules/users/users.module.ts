import { Module } from '@nestjs/common';

import { UsersController } from './controllers/users.controller';
import { USERS_REPOSITORY } from './domain/users.repository';
import { UsersRepositoryAdapter } from './infrastructure/users.repository';
import { UsersService } from './services/users.service';

@Module({
  controllers: [UsersController],
  providers: [
    UsersService,
    {
      provide: USERS_REPOSITORY,
      useClass: UsersRepositoryAdapter,
    },
  ],
})
export class UsersModule {}
