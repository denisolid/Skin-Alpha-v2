import type { SourceAdapterKey } from '../domain/source-adapter.types';

export interface NormalizedListingStorageResultDto {
  readonly source: SourceAdapterKey;
  readonly rawPayloadArchiveId: string;
  readonly storedCount: number;
  readonly skippedCount: number;
  readonly sourceListingIds: readonly string[];
  readonly storedListings: readonly {
    readonly id: string;
    readonly externalListingId: string;
    readonly itemVariantId: string;
    readonly canonicalItemId: string;
    readonly observedAt: Date;
  }[];
}
