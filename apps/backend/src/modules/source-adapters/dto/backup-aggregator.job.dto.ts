import type {
  SourceSyncMode,
  SourceSyncTrigger,
} from '../domain/source-adapter.types';
import type { BackupReferenceProviderKey } from '../domain/backup-reference-provider.interface';

export interface BackupAggregatorSyncJobData {
  readonly trigger: SourceSyncTrigger;
  readonly mode: SourceSyncMode;
  readonly requestedAt: string;
  readonly force?: boolean;
  readonly externalJobId?: string;
  readonly batchBudget?: number;
  readonly targetItemVariantIds?: readonly string[];
  readonly providerKeys?: readonly BackupReferenceProviderKey[];
}
