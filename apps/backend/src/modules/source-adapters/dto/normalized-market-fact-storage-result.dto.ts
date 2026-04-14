import type { SourceAdapterKey } from '../domain/source-adapter.types';

export interface NormalizedMarketFactStorageResultDto {
  readonly source: SourceAdapterKey;
  readonly rawPayloadArchiveId: string;
  readonly storedCount: number;
  readonly skippedCount: number;
  readonly sourceMarketFactIds: readonly string[];
  readonly storedFacts: readonly {
    readonly id: string;
    readonly itemVariantId: string;
    readonly canonicalItemId: string;
    readonly observedAt: Date;
  }[];
}
