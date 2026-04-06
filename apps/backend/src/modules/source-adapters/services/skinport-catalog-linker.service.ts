import { Inject, Injectable } from '@nestjs/common';

import type { CatalogResolutionDto } from '../../catalog/dto/catalog-resolution.dto';
import { CatalogService } from '../../catalog/services/catalog.service';

@Injectable()
export class SkinportCatalogLinkerService {
  constructor(
    @Inject(CatalogService)
    private readonly catalogService: CatalogService,
  ) {}

  resolveOrCreate(
    marketHashName: string,
    version?: string | null,
  ): Promise<CatalogResolutionDto> {
    return this.catalogService.resolveSourceListing({
      source: 'skinport',
      marketHashName,
      ...(version ? { phaseHint: version } : {}),
    });
  }
}
