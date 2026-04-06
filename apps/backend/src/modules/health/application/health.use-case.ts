import type { HealthStatusDto } from '../dto/health-status.dto';

export interface HealthUseCase {
  getHealth(): HealthStatusDto;
}
