import type { UsersStatusDto } from '../dto/users-status.dto';

export interface UsersUseCase {
  getStatus(): UsersStatusDto;
}
