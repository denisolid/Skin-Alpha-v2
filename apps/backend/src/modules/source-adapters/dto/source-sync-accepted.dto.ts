import type {
  SourceAdapterKey,
  SourceSyncMode,
  SourceSyncTrigger,
} from '../domain/source-adapter.types';
import type { SourceAcceptedJobRefDto } from './source-sync-result.dto';

export interface SourceSyncAcceptedDto {
  readonly source: SourceAdapterKey;
  readonly trigger: SourceSyncTrigger;
  readonly mode: SourceSyncMode;
  readonly acceptedAt: Date;
  readonly acceptedJobs: readonly SourceAcceptedJobRefDto[];
  readonly warnings: readonly string[];
}

export interface SourceSyncDispatchFailureDto {
  readonly source: SourceAdapterKey;
  readonly error: string;
}

export interface SourceSyncBatchAcceptedDto {
  readonly requestedAt: Date;
  readonly acceptedSourceCount: number;
  readonly acceptedJobCount: number;
  readonly results: readonly SourceSyncAcceptedDto[];
  readonly failures: readonly SourceSyncDispatchFailureDto[];
}
