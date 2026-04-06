import type { SourceAdapterDescriptor } from '../domain/source-adapter.interface';
import type {
  SourceAdapterKey,
  SourceSyncTrigger,
} from '../domain/source-adapter.types';
import type { SourceHealthModel } from '../domain/source-health.model';
import type { SourceRateLimitStateModel } from '../domain/source-rate-limit-state.model';

export interface SourceScheduleRequest {
  readonly adapter: SourceAdapterDescriptor;
  readonly health: SourceHealthModel;
  readonly rateLimitState: SourceRateLimitStateModel;
  readonly trigger: SourceSyncTrigger;
  readonly requestedAt: Date;
  readonly lastCompletedAt?: Date;
}

export interface SourceScheduleDecision {
  readonly source: SourceAdapterKey;
  readonly shouldRun: boolean;
  readonly scheduledAt: Date;
  readonly reason: string;
  readonly selectedFallback?: SourceAdapterKey;
}

export interface SourceSchedulerContract {
  decide(request: SourceScheduleRequest): Promise<SourceScheduleDecision>;
}
