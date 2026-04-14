import type { ItemCategory } from '@prisma/client';

import type { ModuleSkeletonStatus } from '../../shared/module-skeleton.types';
import type { CatalogItemMappingDto } from '../dto/catalog-item-mapping.dto';

export const CATALOG_REPOSITORY = Symbol('CATALOG_REPOSITORY');
export type CatalogPersistAction = 'existingMatched' | 'created' | 'updated';

export interface PersistCatalogMappingInput {
  readonly source: string;
  readonly mapping: CatalogItemMappingDto;
}

export interface PersistedCatalogMapping {
  readonly canonicalItemId: string;
  readonly itemVariantId: string;
  readonly category: ItemCategory;
  readonly canonicalItemAction: CatalogPersistAction;
  readonly itemVariantAction: CatalogPersistAction;
}

export interface CatalogRepository {
  getModuleSkeleton(): ModuleSkeletonStatus;
  upsertResolvedMapping(
    input: PersistCatalogMappingInput,
  ): Promise<PersistedCatalogMapping>;
  upsertResolvedMappings(
    inputs: readonly PersistCatalogMappingInput[],
  ): Promise<readonly PersistedCatalogMapping[]>;
}
