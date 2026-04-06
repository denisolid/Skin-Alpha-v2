import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { AppConfigService } from '../../../infrastructure/config/app-config.service';
import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.constants';
import {
  createUnknownSourceRateLimitState,
  type SourceRateLimitStateModel,
} from '../domain/source-rate-limit-state.model';

type CsFloatRateLimitEndpoint = 'listings' | 'listing-detail';

interface EndpointBudgetDefaults {
  readonly limit: number;
  readonly windowSeconds: number;
}

interface StoredRateLimitState {
  readonly limit: number;
  readonly remaining: number;
  readonly resetsAt: number;
  readonly retryAfterSeconds?: number;
}

interface ReservationResult {
  readonly granted: boolean;
  readonly retryAfterSeconds?: number;
  readonly state: SourceRateLimitStateModel;
}

interface HeaderRateLimitSnapshot {
  readonly limit?: number;
  readonly remaining?: number;
  readonly resetAt?: Date;
  readonly retryAfterSeconds?: number;
  readonly headers: Record<string, string>;
}

@Injectable()
export class CsFloatRateLimitService {
  constructor(
    @Inject(REDIS_CLIENT)
    private readonly redisClient: Redis,
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
  ) {}

  async getState(): Promise<SourceRateLimitStateModel> {
    const [listingsState, detailState] = await Promise.all([
      this.getEndpointState('listings'),
      this.getEndpointState('listing-detail'),
    ]);

    return this.pickMostConstrainedState([listingsState, detailState]);
  }

  async getEndpointState(
    endpoint: CsFloatRateLimitEndpoint,
  ): Promise<SourceRateLimitStateModel> {
    const now = Date.now();
    const storedState = await this.readState(endpoint, now);

    return this.toSourceRateLimitState(storedState, now);
  }

  async reserve(
    endpoint: CsFloatRateLimitEndpoint,
    permits: number,
  ): Promise<ReservationResult> {
    const now = Date.now();
    const storedState = await this.readState(endpoint, now);

    if (storedState.remaining < permits) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((storedState.resetsAt - now) / 1000),
      );

      return {
        granted: false,
        retryAfterSeconds,
        state: {
          ...this.toSourceRateLimitState(storedState, now),
          status: 'cooldown',
          retryAfterSeconds,
        },
      };
    }

    const nextState: StoredRateLimitState = {
      ...storedState,
      remaining: Math.max(0, storedState.remaining - permits),
    };

    await this.writeState(endpoint, nextState, now);

    return {
      granted: true,
      state: this.toSourceRateLimitState(nextState, now),
    };
  }

  async recordResponse(
    endpoint: CsFloatRateLimitEndpoint,
    headers: Headers,
  ): Promise<HeaderRateLimitSnapshot> {
    const snapshot = this.extractHeaderSnapshot(headers);
    const defaults = this.getDefaults(endpoint);
    const now = Date.now();
    const nextState: StoredRateLimitState = {
      limit: snapshot.limit ?? defaults.limit,
      remaining: snapshot.remaining ?? defaults.limit,
      resetsAt:
        snapshot.resetAt?.getTime() ?? now + defaults.windowSeconds * 1000,
      ...(snapshot.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: snapshot.retryAfterSeconds }
        : {}),
    };

    await this.writeState(endpoint, nextState, now);

    return snapshot;
  }

  async markRateLimited(
    endpoint: CsFloatRateLimitEndpoint,
    retryAfterSeconds?: number,
  ): Promise<void> {
    const defaults = this.getDefaults(endpoint);
    const now = Date.now();
    const waitSeconds = retryAfterSeconds ?? defaults.windowSeconds;
    const nextState: StoredRateLimitState = {
      limit: defaults.limit,
      remaining: 0,
      resetsAt: now + waitSeconds * 1000,
      retryAfterSeconds: waitSeconds,
    };

    await this.writeState(endpoint, nextState, now);
  }

  private async readState(
    endpoint: CsFloatRateLimitEndpoint,
    now: number,
  ): Promise<StoredRateLimitState> {
    const rawValue = await this.redisClient.get(this.buildRedisKey(endpoint));
    const defaults = this.getDefaults(endpoint);

    if (!rawValue) {
      return {
        limit: defaults.limit,
        remaining: defaults.limit,
        resetsAt: now + defaults.windowSeconds * 1000,
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
        limit: defaults.limit,
        remaining: defaults.limit,
        resetsAt: now + defaults.windowSeconds * 1000,
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

  private async writeState(
    endpoint: CsFloatRateLimitEndpoint,
    state: StoredRateLimitState,
    now: number,
  ): Promise<void> {
    await this.redisClient.set(
      this.buildRedisKey(endpoint),
      JSON.stringify(state),
      'EX',
      Math.max(1, Math.ceil((state.resetsAt - now) / 1000)),
    );
  }

  private pickMostConstrainedState(
    states: readonly SourceRateLimitStateModel[],
  ): SourceRateLimitStateModel {
    return (
      [...states].sort((left, right) => {
        const leftRemaining = left.windowRemaining ?? Number.MAX_SAFE_INTEGER;
        const rightRemaining = right.windowRemaining ?? Number.MAX_SAFE_INTEGER;

        return leftRemaining - rightRemaining;
      })[0] ?? createUnknownSourceRateLimitState()
    );
  }

  private extractHeaderSnapshot(headers: Headers): HeaderRateLimitSnapshot {
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
    ]);
    const resetValue = this.readHeaderNumber(normalizedHeaders, [
      'x-ratelimit-reset',
      'ratelimit-reset',
    ]);
    const resetAt =
      resetValue !== undefined
        ? new Date(resetValue > 10_000_000_000 ? resetValue : resetValue * 1000)
        : undefined;

    return {
      ...(limit !== undefined ? { limit } : {}),
      ...(remaining !== undefined ? { remaining } : {}),
      ...(resetAt ? { resetAt } : {}),
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      headers: normalizedHeaders,
    };
  }

  private toSourceRateLimitState(
    state: StoredRateLimitState,
    now: number,
  ): SourceRateLimitStateModel {
    const retryAfterSeconds = Math.max(
      0,
      Math.ceil((state.resetsAt - now) / 1000),
    );

    return {
      status:
        state.remaining === 0
          ? 'cooldown'
          : state.remaining <= 2
            ? 'limited'
            : 'available',
      checkedAt: new Date(now),
      windowLimit: state.limit,
      windowRemaining: state.remaining,
      resetsAt: new Date(state.resetsAt),
      ...(retryAfterSeconds > 0 ? { retryAfterSeconds } : {}),
    };
  }

  private buildRedisKey(endpoint: CsFloatRateLimitEndpoint): string {
    return `source:csfloat:rate-limit:${endpoint}`;
  }

  private getDefaults(
    endpoint: CsFloatRateLimitEndpoint,
  ): EndpointBudgetDefaults {
    if (endpoint === 'listing-detail') {
      return {
        limit: this.configService.csfloatDetailRateLimitMaxRequests,
        windowSeconds: this.configService.csfloatDetailRateLimitWindowSeconds,
      };
    }

    return {
      limit: this.configService.csfloatListingsRateLimitMaxRequests,
      windowSeconds: this.configService.csfloatListingsRateLimitWindowSeconds,
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

      if (!Number.isNaN(parsedValue)) {
        return parsedValue;
      }
    }

    return undefined;
  }
}
