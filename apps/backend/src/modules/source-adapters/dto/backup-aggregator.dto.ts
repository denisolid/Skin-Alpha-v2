import type { BackupReferenceProviderKey } from '../domain/backup-reference-provider.interface';

export interface BackupAggregatorTargetDto {
  readonly canonicalItemId: string;
  readonly itemVariantId: string;
  readonly marketHashName: string;
  readonly priorityScore: number;
  readonly priorityReason: string;
  readonly backupObservedAt?: string;
}

export interface BackupAggregatorBatchPlanDto {
  readonly batchId: string;
  readonly targets: readonly BackupAggregatorTargetDto[];
}

export interface BackupReferenceProviderFetchResultDto {
  readonly providerKey: BackupReferenceProviderKey;
  readonly endpointName: string;
  readonly observedAt: Date;
  readonly httpStatus?: number;
  readonly payload: Record<string, unknown>;
  readonly warnings: readonly string[];
}

export interface BackupReferenceObservationDto {
  readonly providerKey: BackupReferenceProviderKey;
  readonly rawPayloadArchiveId: string;
  readonly canonicalItemId: string;
  readonly itemVariantId: string;
  readonly marketHashName: string;
  readonly observedAt: Date;
  readonly currency: string;
  readonly backupPriceMinor: number;
  readonly listedQuantity?: number;
  readonly sourceConfidence: number;
  readonly sampleSize?: number;
  readonly liquidityScore?: number;
  readonly metadata?: Record<string, unknown>;
}

export interface BackupReferenceNormalizationResultDto {
  readonly providerKey: BackupReferenceProviderKey;
  readonly observations: readonly BackupReferenceObservationDto[];
  readonly warnings: readonly string[];
}
