import type { SourceAdapterKey } from '../domain/source-adapter.types';
import type { NormalizedMarketListingDto } from './normalized-market-listing.dto';
import type { NormalizedMarketStateDto } from './normalized-market-state.dto';

export interface NormalizedSourcePayloadDto {
  readonly rawPayloadArchiveId: string;
  readonly source: SourceAdapterKey;
  readonly endpointName: string;
  readonly observedAt: Date;
  readonly payloadHash: string;
  readonly listings: readonly NormalizedMarketListingDto[];
  readonly marketStates: readonly NormalizedMarketStateDto[];
  readonly warnings: readonly string[];
}
