import type {
  SourceSyncMode,
  SourceSyncTrigger,
} from '../domain/source-adapter.types';
import type { CsFloatListingsFilterDto } from './csfloat-listing-payload.dto';

export interface CsFloatSyncJobData {
  readonly trigger: SourceSyncTrigger;
  readonly mode: SourceSyncMode;
  readonly requestedAt: string;
  readonly force?: boolean;
  readonly externalJobId?: string;
  readonly filters?: CsFloatListingsFilterDto;
  readonly pageBudget?: number;
  readonly detailBudget?: number;
}

export interface CsFloatListingDetailJobData {
  readonly listingId: string;
  readonly requestedAt: string;
  readonly reason: 'missing-float' | 'missing-seed' | 'missing-stickers';
}
