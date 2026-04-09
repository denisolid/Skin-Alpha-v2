import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';

export interface NormalizedMarketStateInput {
  readonly canonicalItemId?: string;
  readonly itemVariantId?: string;
  readonly capturedAt: Date;
  readonly currency: string;
  readonly listingCount?: number;
  readonly lowestAskMinor?: number;
  readonly highestBidMinor?: number;
  readonly medianAskMinor?: number;
  readonly lastTradeMinor?: number;
  readonly average24hMinor?: number;
  readonly saleCount24h?: number;
  readonly sampleSize?: number;
  readonly confidence?: number;
  readonly liquidityScore?: number;
  readonly metadata?: Record<string, unknown>;
}

export interface UpdateLatestMarketStateBatchInput {
  readonly source: SourceAdapterKey;
  readonly marketStates: readonly NormalizedMarketStateInput[];
  readonly rawPayloadArchiveId?: string;
}
