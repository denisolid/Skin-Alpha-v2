import { Inject, Injectable } from '@nestjs/common';

import type { CatalogResolutionDto } from '../../catalog/dto/catalog-resolution.dto';
import { CatalogService } from '../../catalog/services/catalog.service';

interface ResolveCsFloatListingInput {
  readonly marketHashName: string;
  readonly type?: string | null;
  readonly rarity?: string | number | null;
  readonly exterior?: string | null;
  readonly isStatTrak?: boolean | null;
  readonly isSouvenir?: boolean | null;
  readonly defIndex?: number | null;
  readonly paintIndex?: number | null;
}

@Injectable()
export class CsFloatCatalogLinkerService {
  constructor(
    @Inject(CatalogService)
    private readonly catalogService: CatalogService,
  ) {}

  resolveOrCreate(
    input: ResolveCsFloatListingInput,
  ): Promise<CatalogResolutionDto> {
    return this.catalogService.resolveSourceListing({
      source: 'csfloat',
      marketHashName: input.marketHashName,
      ...(input.type ? { type: input.type } : {}),
      ...(input.rarity !== undefined && input.rarity !== null
        ? { rarity: input.rarity }
        : {}),
      ...(input.exterior ? { exterior: input.exterior } : {}),
      ...(input.isStatTrak !== undefined
        ? { isStatTrak: input.isStatTrak }
        : {}),
      ...(input.isSouvenir !== undefined
        ? { isSouvenir: input.isSouvenir }
        : {}),
      ...(input.defIndex !== undefined && input.defIndex !== null
        ? { defIndex: input.defIndex }
        : {}),
      ...(input.paintIndex !== undefined && input.paintIndex !== null
        ? { paintIndex: input.paintIndex }
        : {}),
    });
  }
}
