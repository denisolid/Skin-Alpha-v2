import type { SyncType } from '@prisma/client';

import type {
  SourceAdapterKey,
  SourceSyncMode,
  SourceSyncTrigger,
} from '../domain/source-adapter.types';
import type { SourceHealthModel } from '../domain/source-health.model';
import type { SourceRateLimitStateModel } from '../domain/source-rate-limit-state.model';
import type { NormalizedMarketListingDto } from './normalized-market-listing.dto';
import type { NormalizedMarketStateDto } from './normalized-market-state.dto';
import type { RawListingSnapshotDto } from './raw-listing-snapshot.dto';

export interface SourceAcceptedJobRefDto {
  readonly syncType: SyncType;
  readonly queueName: string;
  readonly jobName: string;
  readonly externalJobId?: string;
  readonly jobRunId?: string;
}

export interface SourceSyncResultDto {
  readonly source: SourceAdapterKey;
  readonly trigger: SourceSyncTrigger;
  readonly mode: SourceSyncMode;
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly cursor?: string;
  readonly nextCursor?: string;
  readonly listings: readonly NormalizedMarketListingDto[];
  readonly marketStates: readonly NormalizedMarketStateDto[];
  readonly rawSnapshots: readonly RawListingSnapshotDto[];
  readonly health: SourceHealthModel;
  readonly rateLimitState: SourceRateLimitStateModel;
  readonly acceptedJobs: readonly SourceAcceptedJobRefDto[];
  readonly warnings: readonly string[];
}

interface EmptySourceSyncResultOptions {
  readonly source: SourceAdapterKey;
  readonly trigger: SourceSyncTrigger;
  readonly mode: SourceSyncMode;
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly health: SourceHealthModel;
  readonly rateLimitState: SourceRateLimitStateModel;
  readonly acceptedJobs?: readonly SourceAcceptedJobRefDto[];
  readonly warnings?: readonly string[];
}

export function createEmptySourceSyncResult(
  options: EmptySourceSyncResultOptions,
): SourceSyncResultDto {
  return {
    source: options.source,
    trigger: options.trigger,
    mode: options.mode,
    startedAt: options.startedAt,
    completedAt: options.completedAt,
    listings: [],
    marketStates: [],
    rawSnapshots: [],
    health: options.health,
    rateLimitState: options.rateLimitState,
    acceptedJobs: options.acceptedJobs ?? [],
    warnings: options.warnings ?? [],
  };
}
