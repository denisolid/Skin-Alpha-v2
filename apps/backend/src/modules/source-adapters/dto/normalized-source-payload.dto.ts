import type { SourceAdapterKey } from '../domain/source-adapter.types';
import type { NormalizedMarketListingDto } from './normalized-market-listing.dto';
import type { NormalizedMarketStateDto } from './normalized-market-state.dto';

export interface NormalizedMappingSignalDto {
  readonly kind: 'listing' | 'market_fact';
  readonly sourceItemId: string;
  readonly title?: string;
  readonly observedAt: Date;
  readonly resolutionNote: string;
  readonly variantHints?: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;
}

export interface NormalizedSourcePayloadDto {
  readonly rawPayloadArchiveId: string;
  readonly source: SourceAdapterKey;
  readonly endpointName: string;
  readonly observedAt: Date;
  readonly sourceObservedAt?: Date;
  readonly payloadHash: string;
  readonly fetchJobId?: string;
  readonly jobRunId?: string;
  readonly fetchedAt?: Date;
  readonly archivedAt?: Date;
  readonly normalizedAt?: Date;
  readonly equivalentMarketStateSourceArchiveId?: string;
  readonly listings: readonly NormalizedMarketListingDto[];
  readonly marketStates: readonly NormalizedMarketStateDto[];
  readonly mappingSignals?: readonly NormalizedMappingSignalDto[];
  readonly warnings: readonly string[];
}
