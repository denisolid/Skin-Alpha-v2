import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.constants';
import {
  createUnknownSourceRateLimitState,
  type SourceRateLimitStateModel,
} from '../domain/source-rate-limit-state.model';
import type {
  ManagedMarketSourceDefinition,
  ManagedMarketSourceKey,
} from '../domain/managed-market-source.types';
import { ManagedMarketSourceDefinitionsService } from './managed-market-source-definitions.service';

interface StoredRateLimitState {
  readonly limit: number;
  readonly remaining: number;
  readonly resetsAt: number;
  readonly retryAfterSeconds?: number;
}

interface StoredCircuitBreakerState {
  readonly consecutiveFailures: number;
  readonly openedUntil?: number;
}

interface ReservationResult {
  readonly granted: boolean;
  readonly retryAfterSeconds?: number;
  readonly state: SourceRateLimitStateModel;
}

interface CircuitBreakerDecision {
  readonly allowed: boolean;
  readonly consecutiveFailures: number;
  readonly retryAfterSeconds?: number;
}

@Injectable()
export class ManagedMarketSourceRuntimeService {
  constructor(
    @Inject(REDIS_CLIENT)
    private readonly redisClient: Redis,
    @Inject(ManagedMarketSourceDefinitionsService)
    private readonly definitionsService: ManagedMarketSourceDefinitionsService,
  ) {}

  async getRateLimitState(
    source: ManagedMarketSourceKey,
  ): Promise<SourceRateLimitStateModel> {
    const definition = this.definitionsService.get(source);
    const now = Date.now();
    const state = await this.readRateLimitState(definition, now);

    return this.toSourceRateLimitState(state, now);
  }

  async reserve(
    source: ManagedMarketSourceKey,
    permits: number,
  ): Promise<ReservationResult> {
    const definition = this.definitionsService.get(source);
    const now = Date.now();
    const currentState = await this.readRateLimitState(definition, now);

    if (currentState.remaining < permits) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((currentState.resetsAt - now) / 1000),
      );

      return {
        granted: false,
        retryAfterSeconds,
        state: {
          ...this.toSourceRateLimitState(currentState, now),
          status: 'cooldown',
          retryAfterSeconds,
        },
      };
    }

    const nextState: StoredRateLimitState = {
      ...currentState,
      remaining: Math.max(0, currentState.remaining - permits),
    };
    await this.writeRateLimitState(definition, nextState, now);

    return {
      granted: true,
      state: this.toSourceRateLimitState(nextState, now),
    };
  }

  async recordResponse(
    source: ManagedMarketSourceKey,
    headers: Headers,
  ): Promise<void> {
    const definition = this.definitionsService.get(source);
    const snapshot = this.extractHeaderSnapshot(headers);

    if (
      snapshot.limit === undefined &&
      snapshot.remaining === undefined &&
      snapshot.resetAt === undefined &&
      snapshot.retryAfterSeconds === undefined
    ) {
      return;
    }

    const now = Date.now();
    const nextState: StoredRateLimitState = {
      limit: snapshot.limit ?? definition.rateLimitMaxRequests,
      remaining: snapshot.remaining ?? definition.rateLimitMaxRequests,
      resetsAt:
        snapshot.resetAt?.getTime() ??
        now + definition.rateLimitWindowSeconds * 1000,
      ...(snapshot.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: snapshot.retryAfterSeconds }
        : {}),
    };

    await this.writeRateLimitState(definition, nextState, now);
  }

  async markRateLimited(
    source: ManagedMarketSourceKey,
    retryAfterSeconds?: number,
  ): Promise<void> {
    const definition = this.definitionsService.get(source);
    const now = Date.now();
    const waitSeconds = retryAfterSeconds ?? definition.rateLimitWindowSeconds;
    const nextState: StoredRateLimitState = {
      limit: definition.rateLimitMaxRequests,
      remaining: 0,
      resetsAt: now + waitSeconds * 1000,
      retryAfterSeconds: waitSeconds,
    };

    await this.writeRateLimitState(definition, nextState, now);
  }

  async checkCircuitBreaker(
    source: ManagedMarketSourceKey,
  ): Promise<CircuitBreakerDecision> {
    const now = Date.now();
    const state = await this.readCircuitBreakerState(source);

    if (!state.openedUntil || state.openedUntil <= now) {
      return {
        allowed: true,
        consecutiveFailures: state.consecutiveFailures,
      };
    }

    return {
      allowed: false,
      consecutiveFailures: state.consecutiveFailures,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((state.openedUntil - now) / 1000),
      ),
    };
  }

  async recordSuccess(source: ManagedMarketSourceKey): Promise<void> {
    await this.redisClient.del(this.buildCircuitBreakerKey(source));
  }

  async recordFailure(source: ManagedMarketSourceKey): Promise<void> {
    const definition = this.definitionsService.get(source);
    const now = Date.now();
    const currentState = await this.readCircuitBreakerState(source);
    const nextFailures = currentState.consecutiveFailures + 1;
    const nextState: StoredCircuitBreakerState = {
      consecutiveFailures: nextFailures,
      ...(nextFailures >= definition.circuitBreakerFailureThreshold
        ? {
            openedUntil: now + definition.circuitBreakerCooldownSeconds * 1000,
          }
        : {}),
    };

    await this.redisClient.set(
      this.buildCircuitBreakerKey(source),
      JSON.stringify(nextState),
      'EX',
      Math.max(
        definition.circuitBreakerCooldownSeconds,
        definition.circuitBreakerCooldownSeconds * 2,
      ),
    );
  }

  private async readRateLimitState(
    definition: ManagedMarketSourceDefinition,
    now: number,
  ): Promise<StoredRateLimitState> {
    const rawValue = await this.redisClient.get(
      this.buildRateLimitKey(definition.key),
    );

    if (!rawValue) {
      return {
        limit: definition.rateLimitMaxRequests,
        remaining: definition.rateLimitMaxRequests,
        resetsAt: now + definition.rateLimitWindowSeconds * 1000,
      };
    }

    const parsedValue = JSON.parse(rawValue) as Partial<StoredRateLimitState>;

    if (
      typeof parsedValue.limit !== 'number' ||
      typeof parsedValue.remaining !== 'number' ||
      typeof parsedValue.resetsAt !== 'number' ||
      parsedValue.resetsAt <= now
    ) {
      return {
        limit: definition.rateLimitMaxRequests,
        remaining: definition.rateLimitMaxRequests,
        resetsAt: now + definition.rateLimitWindowSeconds * 1000,
      };
    }

    return {
      limit: parsedValue.limit,
      remaining: parsedValue.remaining,
      resetsAt: parsedValue.resetsAt,
      ...(parsedValue.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: parsedValue.retryAfterSeconds }
        : {}),
    };
  }

  private async writeRateLimitState(
    definition: ManagedMarketSourceDefinition,
    state: StoredRateLimitState,
    now: number,
  ): Promise<void> {
    await this.redisClient.set(
      this.buildRateLimitKey(definition.key),
      JSON.stringify(state),
      'EX',
      Math.max(1, Math.ceil((state.resetsAt - now) / 1000)),
    );
  }

  private async readCircuitBreakerState(
    source: ManagedMarketSourceKey,
  ): Promise<StoredCircuitBreakerState> {
    const rawValue = await this.redisClient.get(
      this.buildCircuitBreakerKey(source),
    );

    if (!rawValue) {
      return {
        consecutiveFailures: 0,
      };
    }

    const parsedValue = JSON.parse(
      rawValue,
    ) as Partial<StoredCircuitBreakerState>;

    return {
      consecutiveFailures:
        typeof parsedValue.consecutiveFailures === 'number'
          ? parsedValue.consecutiveFailures
          : 0,
      ...(typeof parsedValue.openedUntil === 'number'
        ? { openedUntil: parsedValue.openedUntil }
        : {}),
    };
  }

  private toSourceRateLimitState(
    state: StoredRateLimitState,
    now: number,
  ): SourceRateLimitStateModel {
    if (!Number.isFinite(state.limit) || !Number.isFinite(state.remaining)) {
      return createUnknownSourceRateLimitState();
    }

    const retryAfterSeconds = Math.max(
      0,
      Math.ceil((state.resetsAt - now) / 1000),
    );

    return {
      status:
        state.remaining === 0
          ? 'cooldown'
          : state.remaining <= Math.max(1, Math.floor(state.limit * 0.15))
            ? 'limited'
            : 'available',
      checkedAt: new Date(now),
      windowLimit: state.limit,
      windowRemaining: state.remaining,
      resetsAt: new Date(state.resetsAt),
      ...(retryAfterSeconds > 0 ? { retryAfterSeconds } : {}),
    };
  }

  private extractHeaderSnapshot(headers: Headers): {
    readonly limit?: number;
    readonly remaining?: number;
    readonly resetAt?: Date;
    readonly retryAfterSeconds?: number;
  } {
    const normalizedHeaders = Object.fromEntries(
      [...headers.entries()].map(([key, value]) => [key.toLowerCase(), value]),
    );
    const limit = this.readHeaderNumber(normalizedHeaders, [
      'x-ratelimit-limit',
      'ratelimit-limit',
    ]);
    const remaining = this.readHeaderNumber(normalizedHeaders, [
      'x-ratelimit-remaining',
      'ratelimit-remaining',
    ]);
    const retryAfterSeconds = this.readHeaderNumber(normalizedHeaders, [
      'retry-after',
      'x-ratelimit-retry-after',
    ]);
    const resetValue = this.readHeaderNumber(normalizedHeaders, [
      'x-ratelimit-reset',
      'ratelimit-reset',
      'x-ratelimit-reset-after',
    ]);
    const resetAt =
      resetValue !== undefined
        ? new Date(
            resetValue > 10_000_000_000
              ? resetValue
              : Date.now() + resetValue * 1000,
          )
        : undefined;

    return {
      ...(limit !== undefined ? { limit } : {}),
      ...(remaining !== undefined ? { remaining } : {}),
      ...(resetAt ? { resetAt } : {}),
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    };
  }

  private readHeaderNumber(
    headers: Record<string, string>,
    names: readonly string[],
  ): number | undefined {
    for (const name of names) {
      const rawValue = headers[name];

      if (!rawValue) {
        continue;
      }

      const parsedValue = Number(rawValue);

      if (Number.isFinite(parsedValue)) {
        return parsedValue;
      }
    }

    return undefined;
  }

  private buildRateLimitKey(source: ManagedMarketSourceKey): string {
    return `source:${source}:managed-rate-limit`;
  }

  private buildCircuitBreakerKey(source: ManagedMarketSourceKey): string {
    return `source:${source}:managed-circuit-breaker`;
  }
}
