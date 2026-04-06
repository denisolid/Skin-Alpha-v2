import type { SourceScheduleDecision } from '../application/source-scheduler.contract';
import type { SourceCapabilitiesModel } from '../domain/source-capabilities.model';
import type { SourceBehaviorFlagsModel } from '../domain/source-behavior-flags.model';
import type { SourceClassification } from '../domain/source-classification.model';
import type { SourceHealthModel } from '../domain/source-health.model';
import type { SourcePriorityModel } from '../domain/source-priority.model';
import type { SourceRateLimitStateModel } from '../domain/source-rate-limit-state.model';
import type {
  SourceAdapterKey,
  SourceCategory,
} from '../domain/source-adapter.types';

export interface SourceAdapterSummaryDto {
  readonly source: SourceAdapterKey;
  readonly displayName: string;
  readonly category: SourceCategory;
  readonly classification: SourceClassification;
  readonly behavior: SourceBehaviorFlagsModel;
  readonly capabilities: SourceCapabilitiesModel;
  readonly priority: SourcePriorityModel;
  readonly health: SourceHealthModel;
  readonly rateLimitState: SourceRateLimitStateModel;
  readonly schedule: SourceScheduleDecision;
}
