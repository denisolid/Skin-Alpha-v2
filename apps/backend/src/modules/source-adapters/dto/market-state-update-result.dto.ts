import type { SourceAdapterKey } from '../domain/source-adapter.types';

export interface MarketStateUpdateResultDto {
  readonly source: SourceAdapterKey;
  readonly rawPayloadArchiveId?: string;
  readonly snapshotCount: number;
  readonly upsertedStateCount: number;
  readonly skippedCount: number;
}
