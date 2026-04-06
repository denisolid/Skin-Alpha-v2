import { Injectable } from '@nestjs/common';

import type {
  SourceScheduleDecision,
  SourceScheduleRequest,
  SourceSchedulerContract,
} from '../../application/source-scheduler.contract';
import type { SourceRateLimitStateModel } from '../../domain/source-rate-limit-state.model';

@Injectable()
export class DefaultSourceSchedulerService implements SourceSchedulerContract {
  decide(request: SourceScheduleRequest): Promise<SourceScheduleDecision> {
    const fallbackSource = request.adapter.priority.fallback.fallbackSources[0];

    if (!request.adapter.priority.enabled) {
      return Promise.resolve({
        source: request.adapter.key,
        shouldRun: false,
        scheduledAt: request.requestedAt,
        reason: 'source-disabled',
      });
    }

    if (
      request.rateLimitState.status === 'blocked' ||
      request.rateLimitState.status === 'cooldown'
    ) {
      return Promise.resolve({
        source: request.adapter.key,
        shouldRun: false,
        scheduledAt: this.resolveRateLimitReset(
          request.requestedAt,
          request.rateLimitState,
        ),
        reason: `rate-limit-${request.rateLimitState.status}`,
        ...(fallbackSource ? { selectedFallback: fallbackSource } : {}),
      });
    }

    if (
      request.health.status === 'down' ||
      request.health.consecutiveFailures >=
        request.adapter.priority.fallback.activateAfterConsecutiveFailures
    ) {
      return Promise.resolve({
        source: request.adapter.key,
        shouldRun: false,
        scheduledAt: new Date(
          request.requestedAt.getTime() +
            request.adapter.priority.fallback.cooldownSeconds * 1000,
        ),
        reason: 'health-fallback',
        ...(fallbackSource ? { selectedFallback: fallbackSource } : {}),
      });
    }

    return Promise.resolve({
      source: request.adapter.key,
      shouldRun: true,
      scheduledAt: request.requestedAt,
      reason:
        request.health.status === 'degraded'
          ? 'degraded-but-runnable'
          : `scheduled-${request.trigger}`,
    });
  }

  private resolveRateLimitReset(
    requestedAt: Date,
    rateLimitState: SourceRateLimitStateModel,
  ): Date {
    if (rateLimitState.resetsAt) {
      return rateLimitState.resetsAt;
    }

    if (rateLimitState.retryAfterSeconds) {
      return new Date(
        requestedAt.getTime() + rateLimitState.retryAfterSeconds * 1000,
      );
    }

    return requestedAt;
  }
}
