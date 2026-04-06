import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';
import type { MarketFetchMode } from './merged-market-matrix.dto';
import type { MarketFreshnessDto } from './market-freshness.dto';

export interface MarketSnapshotHistoryEntryDto {
  readonly snapshotId: string;
  readonly source: SourceAdapterKey;
  readonly sourceName: string;
  readonly ask?: number;
  readonly bid?: number;
  readonly listedQty?: number;
  readonly observedAt: Date;
  readonly freshness: MarketFreshnessDto;
  readonly confidence: number;
  readonly fetchMode: MarketFetchMode;
  readonly currency: string;
  readonly rawPayloadArchiveId?: string;
}

export interface MarketSnapshotHistoryDto {
  readonly generatedAt: Date;
  readonly canonicalItemId: string;
  readonly itemVariantId: string;
  readonly entries: readonly MarketSnapshotHistoryEntryDto[];
}
