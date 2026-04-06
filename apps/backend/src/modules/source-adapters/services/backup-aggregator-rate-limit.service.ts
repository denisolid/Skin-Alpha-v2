import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.constants';
import type {
  BackupReferenceProviderDescriptor,
  BackupReferenceProviderKey,
} from '../domain/backup-reference-provider.interface';
import {
  createUnknownSourceRateLimitState,
  type SourceRateLimitStateModel,
} from '../domain/source-rate-limit-state.model';

interface PersistedRateLimitState {
  readonly status: SourceRateLimitStateModel['status'];
  readonly checkedAt: string;
  readonly windowLimit?: number;
  readonly windowRemaining?: number;
  readonly concurrencyLimit?: number;
  readonly concurrencyInUse?: number;
  readonly retryAfterSeconds?: number;
  readonly resetsAt?: string;
}

@Injectable()
export class BackupAggregatorRateLimitService {
  constructor(
    @Inject(REDIS_CLIENT)
    private readonly redisClient: Redis,
  ) {}

  async getProviderState(
    providerKey: BackupReferenceProviderKey,
  ): Promise<SourceRateLimitStateModel> {
    const rawValue = await this.redisClient.get(
      this.buildRedisKey(providerKey),
    );

    if (!rawValue) {
      return createUnknownSourceRateLimitState();
    }

    const parsedValue = JSON.parse(rawValue) as PersistedRateLimitState;

    return {
      status: parsedValue.status,
      checkedAt: new Date(parsedValue.checkedAt),
      ...(parsedValue.windowLimit !== undefined
        ? { windowLimit: parsedValue.windowLimit }
        : {}),
      ...(parsedValue.windowRemaining !== undefined
        ? { windowRemaining: parsedValue.windowRemaining }
        : {}),
      ...(parsedValue.concurrencyLimit !== undefined
        ? { concurrencyLimit: parsedValue.concurrencyLimit }
        : {}),
      ...(parsedValue.concurrencyInUse !== undefined
        ? { concurrencyInUse: parsedValue.concurrencyInUse }
        : {}),
      ...(parsedValue.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: parsedValue.retryAfterSeconds }
        : {}),
      ...(parsedValue.resetsAt
        ? { resetsAt: new Date(parsedValue.resetsAt) }
        : {}),
    };
  }

  async recordProviderState(
    providerKey: BackupReferenceProviderKey,
    state: SourceRateLimitStateModel,
  ): Promise<void> {
    const serializedState: PersistedRateLimitState = {
      status: state.status,
      checkedAt: state.checkedAt.toISOString(),
      ...(state.windowLimit !== undefined
        ? { windowLimit: state.windowLimit }
        : {}),
      ...(state.windowRemaining !== undefined
        ? { windowRemaining: state.windowRemaining }
        : {}),
      ...(state.concurrencyLimit !== undefined
        ? { concurrencyLimit: state.concurrencyLimit }
        : {}),
      ...(state.concurrencyInUse !== undefined
        ? { concurrencyInUse: state.concurrencyInUse }
        : {}),
      ...(state.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: state.retryAfterSeconds }
        : {}),
      ...(state.resetsAt ? { resetsAt: state.resetsAt.toISOString() } : {}),
    };

    await this.redisClient.set(
      this.buildRedisKey(providerKey),
      JSON.stringify(serializedState),
      'EX',
      this.computeTtlSeconds(state),
    );
  }

  async getAggregateState(
    providers: readonly BackupReferenceProviderDescriptor[],
  ): Promise<SourceRateLimitStateModel> {
    if (providers.length === 0) {
      return createUnknownSourceRateLimitState();
    }

    const states = await Promise.all(
      providers.map((provider) => this.getProviderState(provider.key)),
    );

    return states.reduce((worstState, candidateState) =>
      this.compareSeverity(candidateState, worstState) > 0
        ? candidateState
        : worstState,
    );
  }

  private buildRedisKey(providerKey: BackupReferenceProviderKey): string {
    return `source:backup-aggregator:rate-limit:${providerKey}`;
  }

  private computeTtlSeconds(state: SourceRateLimitStateModel): number {
    if (state.resetsAt) {
      return Math.max(
        60,
        Math.ceil((state.resetsAt.getTime() - Date.now()) / 1000),
      );
    }

    if (state.retryAfterSeconds !== undefined) {
      return Math.max(60, state.retryAfterSeconds);
    }

    return 6 * 60 * 60;
  }

  private compareSeverity(
    left: SourceRateLimitStateModel,
    right: SourceRateLimitStateModel,
  ): number {
    const severityOrder: Record<SourceRateLimitStateModel['status'], number> = {
      unknown: 0,
      available: 1,
      limited: 2,
      cooldown: 3,
      blocked: 4,
    };

    return severityOrder[left.status] - severityOrder[right.status];
  }
}
