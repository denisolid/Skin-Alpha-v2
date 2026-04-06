import { ModuleSkeletonDto } from '../../shared/module-skeleton.dto';
import type { ModuleSkeletonStatus } from '../../shared/module-skeleton.types';

export class UsersStatusDto extends ModuleSkeletonDto {
  constructor(status: ModuleSkeletonStatus) {
    super(status);
  }
}
