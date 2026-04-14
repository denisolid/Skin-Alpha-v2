import { Inject, Injectable } from '@nestjs/common';

import type { SourceAdapterKey } from '../domain/source-adapter.types';
import type { SourceHealthModel } from '../domain/source-health.model';
import type { SourceRateLimitStateModel } from '../domain/source-rate-limit-state.model';
import type { SourceRuntimeGuardState } from '../domain/source-runtime-guard.model';
import { SourceProxyOrchestratorService } from './source-proxy-orchestrator.service';
import { SourceRuntimeGuardService } from './source-runtime-guard.service';
import { SourceSessionAccountRegistryService } from './source-session-account-registry.service';

const DEGRADED_TTL_MS = 45 * 60 * 1000;
const DISABLED_TTL_MS = 4 * 60 * 60 * 1000;

@Injectable()
export class SourceHealthRecoveryService {
  constructor(
    @Inject(SourceProxyOrchestratorService)
    private readonly proxyOrchestratorService: SourceProxyOrchestratorService,
    @Inject(SourceSessionAccountRegistryService)
    private readonly sessionAccountRegistryService: SourceSessionAccountRegistryService,
    @Inject(SourceRuntimeGuardService)
    private readonly runtimeGuardService: SourceRuntimeGuardService,
  ) {}

  async assessAndApply(input: {
    readonly source: SourceAdapterKey;
    readonly health: SourceHealthModel;
    readonly rateLimitState: SourceRateLimitStateModel;
  }): Promise<SourceRuntimeGuardState> {
    const proxyReadiness = this.proxyOrchestratorService.getReadiness(input.source);

    if (!proxyReadiness.available && proxyReadiness.required) {
      await this.runtimeGuardService.disable({
        source: input.source,
        reason: proxyReadiness.reason ?? 'required_proxy_unavailable',
        ttlMs: DISABLED_TTL_MS,
      });

      return this.runtimeGuardService.inspect(input.source);
    }

    const sessionReadiness =
      this.sessionAccountRegistryService.getReadiness(input.source);

    if (!sessionReadiness.available && sessionReadiness.required) {
      await this.runtimeGuardService.disable({
        source: input.source,
        reason:
          sessionReadiness.reason ??
          'required_session_or_account_unavailable',
        ttlMs: DISABLED_TTL_MS,
      });

      return this.runtimeGuardService.inspect(input.source);
    }

    if (input.rateLimitState.status === 'blocked') {
      await this.runtimeGuardService.holdCooldown({
        source: input.source,
        reason: 'source_rate_limit_blocked',
        ttlMs:
          Math.max(60, input.rateLimitState.retryAfterSeconds ?? 300) * 1000,
      });

      return this.runtimeGuardService.inspect(input.source);
    }

    if (
      input.health.status === 'down' ||
      input.health.consecutiveFailures >= 6
    ) {
      await this.runtimeGuardService.disable({
        source: input.source,
        reason: 'repeated_source_failures',
        ttlMs: DISABLED_TTL_MS,
        details: {
          consecutiveFailures: input.health.consecutiveFailures,
        },
      });

      return this.runtimeGuardService.inspect(input.source);
    }

    if (
      input.health.status === 'degraded' ||
      input.health.consecutiveFailures >= 3
    ) {
      await this.runtimeGuardService.holdDegraded({
        source: input.source,
        reason: 'source_degraded',
        ttlMs: DEGRADED_TTL_MS,
        details: {
          consecutiveFailures: input.health.consecutiveFailures,
        },
      });

      return this.runtimeGuardService.inspect(input.source);
    }

    await this.runtimeGuardService.clear(input.source);

    return this.runtimeGuardService.inspect(input.source);
  }
}
