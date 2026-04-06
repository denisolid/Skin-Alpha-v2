import type { CatalogStatusDto } from '../dto/catalog-status.dto';

export interface CatalogUseCase {
  getStatus(): CatalogStatusDto;
}
