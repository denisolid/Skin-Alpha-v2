import type {
  SourceAdapter,
  SourceAdapterDescriptor,
  SourceSyncContext,
} from '../../domain/source-adapter.interface';
import {
  createUnknownSourceHealth,
  type SourceHealthModel,
} from '../../domain/source-health.model';
import {
  createUnknownSourceRateLimitState,
  type SourceRateLimitStateModel,
} from '../../domain/source-rate-limit-state.model';
import {
  createEmptySourceSyncResult,
  type SourceSyncResultDto,
} from '../../dto/source-sync-result.dto';

export abstract class BaseSourceAdapter implements SourceAdapter {
  abstract readonly descriptor: SourceAdapterDescriptor;

  getHealth(): Promise<SourceHealthModel> {
    return Promise.resolve(createUnknownSourceHealth());
  }

  getRateLimitState(): Promise<SourceRateLimitStateModel> {
    return Promise.resolve(createUnknownSourceRateLimitState());
  }

  async sync(context: SourceSyncContext): Promise<SourceSyncResultDto> {
    const [health, rateLimitState] = await Promise.all([
      this.getHealth(),
      this.getRateLimitState(),
    ]);

    return createEmptySourceSyncResult({
      source: this.descriptor.key,
      trigger: context.trigger,
      mode: context.mode,
      startedAt: context.requestedAt,
      completedAt: new Date(),
      health,
      rateLimitState,
      warnings: [
        `${this.descriptor.displayName} adapter is not implemented yet.`,
      ],
    });
  }
}
