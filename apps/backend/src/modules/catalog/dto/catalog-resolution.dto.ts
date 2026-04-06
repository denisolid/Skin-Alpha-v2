import type { ItemCategory } from '@prisma/client';

import type { CatalogItemMappingDto } from './catalog-item-mapping.dto';

export const CATALOG_RESOLUTION_STATUSES = ['resolved', 'unresolved'] as const;

export type CatalogResolutionStatus =
  (typeof CATALOG_RESOLUTION_STATUSES)[number];

export interface CatalogResolutionDto {
  readonly status: CatalogResolutionStatus;
  readonly confidence: number;
  readonly reason?: string;
  readonly warnings: readonly string[];
  readonly mapping: CatalogItemMappingDto;
  readonly canonicalItemId?: string;
  readonly itemVariantId?: string;
  readonly category?: ItemCategory;
}
