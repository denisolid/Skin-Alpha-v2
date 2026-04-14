import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';

export interface MarketStateUpdateResultDto {
  readonly source: SourceAdapterKey;
  readonly rawPayloadArchiveId?: string;
  readonly snapshotCount: number;
  readonly upsertedStateCount: number;
  readonly skippedCount: number;
  readonly unchangedProjectionSkipCount: number;
}
