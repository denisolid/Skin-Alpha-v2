import type {
  SourceAdapterKey,
  SourceSyncMode,
  SourceSyncTrigger,
} from './source-adapter.types';
import type { SourceBehaviorFlagsModel } from './source-behavior-flags.model';
import type { SourceClassification } from './source-classification.model';

export const MANAGED_MARKET_SOURCE_KEYS = [
  'youpin',
  'bitskins',
  'c5game',
  'csmoney',
] as const;

export type ManagedMarketSourceKey =
  (typeof MANAGED_MARKET_SOURCE_KEYS)[number];

export interface ManagedMarketTargetDto {
  readonly canonicalItemId: string;
  readonly itemVariantId: string;
  readonly marketHashName: string;
  readonly priorityScore: number;
  readonly priorityReason: string;
  readonly existingSourceCount: number;
  readonly overlapSourceCodes: readonly SourceAdapterKey[];
}

export interface ManagedMarketBatchPlanDto {
  readonly batchId: string;
  readonly targets: readonly ManagedMarketTargetDto[];
}

export interface ManagedMarketSyncJobData {
  readonly trigger: SourceSyncTrigger;
  readonly mode: SourceSyncMode;
  readonly requestedAt: string;
  readonly force?: boolean;
  readonly externalJobId?: string;
  readonly targetItemVariantIds?: readonly string[];
  readonly batchBudget?: number;
}

export interface ManagedMarketSourceDefinition {
  readonly key: ManagedMarketSourceKey;
  readonly displayName: string;
  readonly endpointName: string;
  readonly queueName: string;
  readonly queueToken: symbol;
  readonly classification: SourceClassification;
  readonly behavior: SourceBehaviorFlagsModel;
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly currency: string;
  readonly pageLimit: number;
  readonly batchSize: number;
  readonly batchBudget: number;
  readonly rateLimitWindowSeconds: number;
  readonly rateLimitMaxRequests: number;
  readonly retryAttempts: number;
  readonly retryBaseDelayMs: number;
  readonly circuitBreakerFailureThreshold: number;
  readonly circuitBreakerCooldownSeconds: number;
  readonly targetQueryMode: 'broad' | 'hot-universe' | 'overlap-first';
  readonly requestPath: string;
  readonly notes: readonly string[];
}
