import type { SourceAdapterKey } from '../domain/source-adapter.types';

export interface NormalizedMarketListingDto {
  readonly source: SourceAdapterKey;
  readonly externalListingId: string;
  readonly sourceItemId: string;
  readonly canonicalItemId?: string;
  readonly itemVariantId?: string;
  readonly title: string;
  readonly observedAt: Date;
  readonly currency: string;
  readonly listingUrl?: string;
  readonly priceMinor: number;
  readonly netPriceMinor?: number;
  readonly quantityAvailable: number;
  readonly condition?: string;
  readonly phase?: string;
  readonly paintSeed?: number;
  readonly wearFloat?: number;
  readonly isStatTrak: boolean;
  readonly isSouvenir: boolean;
  readonly metadata?: Record<string, unknown>;
}
