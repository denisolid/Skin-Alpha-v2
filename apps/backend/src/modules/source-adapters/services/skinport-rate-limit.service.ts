import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { AppConfigService } from '../../../infrastructure/config/app-config.service';
import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.constants';
import type { SourceRateLimitStateModel } from '../domain/source-rate-limit-state.model';

interface SkinportRateLimitWindowState {
  readonly requestCount: number;
  readonly resetsAt: number;
}

interface SkinportRateLimitReservation {
  readonly granted: boolean;
  readonly retryAfterSeconds?: number;
  readonly state: SourceRateLimitStateModel;
}

@Injectable()
export class SkinportRateLimitService {
  private readonly redisKey = 'source:skinport:rate-limit';

  constructor(
    @Inject(REDIS_CLIENT)
    private readonly redisClient: Redis,
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
  ) {}

  async getState(): Promise<SourceRateLimitStateModel> {
    return this.buildState();
  }

  async reserveRequestSlot(
    permits: number,
  ): Promise<SkinportRateLimitReservation> {
    const now = Date.now();
    const windowState = await this.readWindowState(now);
    const projectedRequestCount = windowState.requestCount + permits;

    if (
      projectedRequestCount > this.configService.skinportRateLimitMaxRequests
    ) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((windowState.resetsAt - now) / 1000),
      );

      return {
        granted: false,
        retryAfterSeconds,
        state: {
          status: 'cooldown',
          checkedAt: new Date(now),
          windowLimit: this.configService.skinportRateLimitMaxRequests,
          windowRemaining: Math.max(
            0,
            this.configService.skinportRateLimitMaxRequests -
              windowState.requestCount,
          ),
          retryAfterSeconds,
          resetsAt: new Date(windowState.resetsAt),
        },
      };
    }

    const nextWindowState: SkinportRateLimitWindowState = {
      requestCount: projectedRequestCount,
      resetsAt: windowState.resetsAt,
    };

    await this.redisClient.set(
      this.redisKey,
      JSON.stringify(nextWindowState),
      'EX',
      Math.max(1, Math.ceil((windowState.resetsAt - now) / 1000)),
    );

    return {
      granted: true,
      state: this.toRateLimitState(nextWindowState, now),
    };
  }

  async markRateLimited(retryAfterSeconds?: number): Promise<void> {
    const now = Date.now();
    const resetsAt =
      now +
      (retryAfterSeconds ?? this.configService.skinportRateLimitWindowSeconds) *
        1000;

    await this.redisClient.set(
      this.redisKey,
      JSON.stringify({
        requestCount: this.configService.skinportRateLimitMaxRequests,
        resetsAt,
      } satisfies SkinportRateLimitWindowState),
      'EX',
      Math.max(1, Math.ceil((resetsAt - now) / 1000)),
    );
  }

  private async buildState(): Promise<SourceRateLimitStateModel> {
    const now = Date.now();
    const windowState = await this.readWindowState(now);

    return this.toRateLimitState(windowState, now);
  }

  private async readWindowState(
    now: number,
  ): Promise<SkinportRateLimitWindowState> {
    const rawValue = await this.redisClient.get(this.redisKey);

    if (!rawValue) {
      return {
        requestCount: 0,
        resetsAt:
          now + this.configService.skinportRateLimitWindowSeconds * 1000,
      };
    }

    const parsedValue = JSON.parse(
      rawValue,
    ) as Partial<SkinportRateLimitWindowState>;

    if (
      typeof parsedValue.requestCount !== 'number' ||
      typeof parsedValue.resetsAt !== 'number' ||
      parsedValue.resetsAt <= now
    ) {
      return {
        requestCount: 0,
        resetsAt:
          now + this.configService.skinportRateLimitWindowSeconds * 1000,
      };
    }

    return {
      requestCount: parsedValue.requestCount,
      resetsAt: parsedValue.resetsAt,
    };
  }

  private toRateLimitState(
    windowState: SkinportRateLimitWindowState,
    now: number,
  ): SourceRateLimitStateModel {
    const windowRemaining = Math.max(
      0,
      this.configService.skinportRateLimitMaxRequests -
        windowState.requestCount,
    );
    const retryAfterSeconds = Math.max(
      0,
      Math.ceil((windowState.resetsAt - now) / 1000),
    );

    return {
      status:
        windowRemaining === 0
          ? 'cooldown'
          : windowRemaining <= 2
            ? 'limited'
            : 'available',
      checkedAt: new Date(now),
      windowLimit: this.configService.skinportRateLimitMaxRequests,
      windowRemaining,
      resetsAt: new Date(windowState.resetsAt),
      ...(retryAfterSeconds > 0 ? { retryAfterSeconds } : {}),
    };
  }
}
