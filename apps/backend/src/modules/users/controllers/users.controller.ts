import { Controller, Get, Inject } from '@nestjs/common';

import { UsersStatusDto } from '../dto/users-status.dto';
import { UsersService } from '../services/users.service';

@Controller('users')
export class UsersController {
  constructor(
    @Inject(UsersService) private readonly usersService: UsersService,
  ) {}

  @Get()
  getStatus(): UsersStatusDto {
    return this.usersService.getStatus();
  }
}
