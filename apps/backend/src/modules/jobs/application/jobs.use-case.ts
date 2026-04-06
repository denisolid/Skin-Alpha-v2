import type { JobsStatusDto } from '../dto/jobs-status.dto';

export interface JobsUseCase {
  getStatus(): JobsStatusDto;
}
