import type { SourceAdapterKey } from '../domain/source-adapter.types';

export interface NormalizedMarketStateDto {
  readonly source: SourceAdapterKey;
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
