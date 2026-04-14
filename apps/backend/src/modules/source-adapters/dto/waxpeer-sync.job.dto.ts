import type {
  SourceSyncMode,
  SourceSyncTrigger,
} from '../domain/source-adapter.types';

export interface WaxpeerSyncJobData {
  readonly trigger: SourceSyncTrigger;
  readonly mode: SourceSyncMode;
  readonly requestedAt: string;
  readonly force?: boolean;
  readonly externalJobId?: string;
  readonly targetItemVariantIds?: readonly string[];
  readonly batchBudget?: number;
}
