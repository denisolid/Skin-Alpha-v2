import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { AppConfigService } from '../../../infrastructure/config/app-config.service';
import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.constants';
import type { SourceRateLimitStateModel } from '../domain/source-rate-limit-state.model';

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
export class DMarketRateLimitService {
  constructor(
    @Inject(REDIS_CLIENT)
    private readonly redisClient: Redis,
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
  ) {}

  async getState(): Promise<SourceRateLimitStateModel> {
    const now = Date.now();
    const state = await this.readState(now);

    return this.toRateLimitState(state, now);
  }

  async reserve(permits: number): Promise<ReservationResult> {
    const now = Date.now();
    const state = await this.readState(now);

    if (state.remaining < permits) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((state.resetsAt - now) / 1000),
      );

      return {
        granted: false,
        retryAfterSeconds,
        state: {
          ...this.toRateLimitState(state, now),
          retryAfterSeconds,
          status: 'cooldown',
        },
      };
    }

    const nextState: StoredRateLimitState = {
      ...state,
      remaining: Math.max(0, state.remaining - permits),
    };

    await this.writeState(nextState, now);

    return {
      granted: true,
      state: this.toRateLimitState(nextState, now),
    };
  }

  async recordResponse(headers: Headers): Promise<HeaderRateLimitSnapshot> {
    const snapshot = this.extractSnapshot(headers);
    const now = Date.now();
    const nextState: StoredRateLimitState = {
      limit: snapshot.limit ?? this.configService.dmarketRateLimitMaxRequests,
      remaining:
        snapshot.remaining ?? this.configService.dmarketRateLimitMaxRequests,
      resetsAt:
        snapshot.resetAt?.getTime() ??
        now + this.configService.dmarketRateLimitWindowSeconds * 1000,
      ...(snapshot.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: snapshot.retryAfterSeconds }
        : {}),
    };

    await this.writeState(nextState, now);

    return snapshot;
  }

  async markRateLimited(retryAfterSeconds?: number): Promise<void> {
    const now = Date.now();
    const waitSeconds =
      retryAfterSeconds ?? this.configService.dmarketRateLimitWindowSeconds;

    await this.writeState(
      {
        limit: this.configService.dmarketRateLimitMaxRequests,
        remaining: 0,
        resetsAt: now + waitSeconds * 1000,
        retryAfterSeconds: waitSeconds,
      },
      now,
    );
  }

  private async readState(now: number): Promise<StoredRateLimitState> {
    const rawValue = await this.redisClient.get(this.getRedisKey());

    if (!rawValue) {
      return {
        limit: this.configService.dmarketRateLimitMaxRequests,
        remaining: this.configService.dmarketRateLimitMaxRequests,
        resetsAt: now + this.configService.dmarketRateLimitWindowSeconds * 1000,
      };
    }

    const parsed = JSON.parse(rawValue) as Partial<StoredRateLimitState>;

    if (
      typeof parsed.limit !== 'number' ||
      typeof parsed.remaining !== 'number' ||
      typeof parsed.resetsAt !== 'number' ||
      parsed.resetsAt <= now
    ) {
      return {
        limit: this.configService.dmarketRateLimitMaxRequests,
        remaining: this.configService.dmarketRateLimitMaxRequests,
        resetsAt: now + this.configService.dmarketRateLimitWindowSeconds * 1000,
      };
    }

    return {
      limit: parsed.limit,
      remaining: parsed.remaining,
      resetsAt: parsed.resetsAt,
      ...(parsed.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: parsed.retryAfterSeconds }
        : {}),
    };
  }

  private async writeState(
    state: StoredRateLimitState,
    now: number,
  ): Promise<void> {
    await this.redisClient.set(
      this.getRedisKey(),
      JSON.stringify(state),
      'EX',
      Math.max(1, Math.ceil((state.resetsAt - now) / 1000)),
    );
  }

  private extractSnapshot(headers: Headers): HeaderRateLimitSnapshot {
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

    return {
      ...(limit !== undefined ? { limit } : {}),
      ...(remaining !== undefined ? { remaining } : {}),
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      ...(resetValue !== undefined
        ? {
            resetAt: new Date(
              resetValue > 10_000_000_000 ? resetValue : resetValue * 1000,
            ),
          }
        : {}),
      headers: normalizedHeaders,
    };
  }

  private toRateLimitState(
    state: StoredRateLimitState,
    now: number,
  ): SourceRateLimitStateModel {
    const retryAfterSeconds = Math.max(
      0,
      Math.ceil((state.resetsAt - now) / 1000),
    );

    return {
      checkedAt: new Date(now),
      status:
        state.remaining === 0
          ? 'cooldown'
          : state.remaining <= 2
            ? 'limited'
            : 'available',
      windowLimit: state.limit,
      windowRemaining: state.remaining,
      resetsAt: new Date(state.resetsAt),
      ...(retryAfterSeconds > 0 ? { retryAfterSeconds } : {}),
    };
  }

  private getRedisKey(): string {
    return 'source:dmarket:rate-limit:market-items';
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
