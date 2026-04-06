import type { SourceSyncResultDto } from '../dto/source-sync-result.dto';
import type { SourceCapabilitiesModel } from './source-capabilities.model';
import type { SourceBehaviorFlagsModel } from './source-behavior-flags.model';
import type { SourceClassification } from './source-classification.model';
import type { SourceHealthModel } from './source-health.model';
import type { SourcePriorityModel } from './source-priority.model';
import type { SourceRateLimitStateModel } from './source-rate-limit-state.model';
import type {
  SourceAdapterKey,
  SourceCategory,
  SourceSyncMode,
  SourceSyncTrigger,
} from './source-adapter.types';

export interface SourceSyncContext {
  readonly trigger: SourceSyncTrigger;
  readonly mode: SourceSyncMode;
  readonly requestedAt: Date;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface SourceAdapterDescriptor {
  readonly key: SourceAdapterKey;
  readonly displayName: string;
  readonly category: SourceCategory;
  readonly classification: SourceClassification;
  readonly behavior: SourceBehaviorFlagsModel;
  readonly capabilities: SourceCapabilitiesModel;
  readonly priority: SourcePriorityModel;
}

export interface SourceAdapter {
  readonly descriptor: SourceAdapterDescriptor;
  getHealth(): Promise<SourceHealthModel>;
  getRateLimitState(): Promise<SourceRateLimitStateModel>;
  sync(context: SourceSyncContext): Promise<SourceSyncResultDto>;
}
