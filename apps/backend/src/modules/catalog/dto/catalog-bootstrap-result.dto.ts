export type CatalogBootstrapStatus =
  | 'existingMatched'
  | 'created'
  | 'updated'
  | 'skipped'
  | 'failed';

export interface CatalogBootstrapSummaryDto {
  readonly existingMatched: number;
  readonly created: number;
  readonly updated: number;
  readonly skipped: number;
  readonly failed: number;
}

export interface CatalogBootstrapSeedEntityResultDto {
  readonly status: CatalogBootstrapStatus;
  readonly id?: string;
}

export interface CatalogBootstrapSeedResultDto {
  readonly marketHashName: string;
  readonly canonicalSlug?: string;
  readonly variantKey?: string;
  readonly status: CatalogBootstrapStatus;
  readonly canonicalItem: CatalogBootstrapSeedEntityResultDto;
  readonly itemVariant: CatalogBootstrapSeedEntityResultDto;
  readonly warnings: readonly string[];
  readonly failureReason?: string;
}

export interface CatalogBootstrapResultDto {
  readonly universe: string;
  readonly seededItemCount: number;
  readonly canonicalItemsCreated: number;
  readonly itemVariantsCreated: number;
  readonly seedItems: CatalogBootstrapSummaryDto;
  readonly canonicalItems: CatalogBootstrapSummaryDto;
  readonly itemVariants: CatalogBootstrapSummaryDto;
  readonly results: readonly CatalogBootstrapSeedResultDto[];
  readonly warnings: readonly string[];
}
