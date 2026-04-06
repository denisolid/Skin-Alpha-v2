import type { SourceAdapterKey } from '../domain/source-adapter.types';

export interface NormalizedListingStorageResultDto {
  readonly source: SourceAdapterKey;
  readonly rawPayloadArchiveId: string;
  readonly storedCount: number;
  readonly skippedCount: number;
  readonly sourceListingIds: readonly string[];
}
