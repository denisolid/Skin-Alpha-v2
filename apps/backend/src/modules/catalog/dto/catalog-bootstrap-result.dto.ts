export interface CatalogBootstrapResultDto {
  readonly universe: string;
  readonly seededItemCount: number;
  readonly canonicalItemsCreated: number;
  readonly itemVariantsCreated: number;
  readonly warnings: readonly string[];
}
