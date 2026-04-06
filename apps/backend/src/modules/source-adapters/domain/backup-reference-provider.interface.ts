import type { ArchivedRawPayloadDto } from '../dto/archived-raw-payload.dto';
import type {
  BackupAggregatorBatchPlanDto,
  BackupReferenceNormalizationResultDto,
  BackupReferenceProviderFetchResultDto,
} from '../dto/backup-aggregator.dto';
import type { SourceRateLimitStateModel } from './source-rate-limit-state.model';

export const BACKUP_REFERENCE_PROVIDER_KEYS = ['cs2sh'] as const;

export type BackupReferenceProviderKey =
  (typeof BACKUP_REFERENCE_PROVIDER_KEYS)[number];

export interface BackupReferenceProviderDescriptor {
  readonly key: BackupReferenceProviderKey;
  readonly displayName: string;
  readonly priority: number;
  readonly baseConfidence: number;
}

export interface BackupReferenceFetchBatchInput {
  readonly batch: BackupAggregatorBatchPlanDto;
  readonly requestedAt: string;
  readonly jobRunId: string;
}

export interface BackupReferenceProvider {
  readonly descriptor: BackupReferenceProviderDescriptor;
  isEnabled(): boolean;
  getRateLimitState(): Promise<SourceRateLimitStateModel>;
  fetchBatch(
    input: BackupReferenceFetchBatchInput,
  ): Promise<BackupReferenceProviderFetchResultDto>;
  normalizeArchivedPayload(
    archive: ArchivedRawPayloadDto,
  ): BackupReferenceNormalizationResultDto;
}

export class BackupReferenceProviderThrottleError extends Error {
  constructor(
    readonly providerKey: BackupReferenceProviderKey,
    readonly retryAfterSeconds?: number,
    message?: string,
  ) {
    super(
      message ??
        `Backup reference provider "${providerKey}" is cooling down before the next fetch window.`,
    );
  }
}
