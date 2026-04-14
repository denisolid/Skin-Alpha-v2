import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.constants';
import type { SourceAdapterKey } from '../domain/source-adapter.types';
import type { SourceRuntimeGuardState } from '../domain/source-runtime-guard.model';

interface StoredRuntimeGuardState {
  readonly mode: Exclude<SourceRuntimeGuardState['mode'], 'active'>;
  readonly reason: string;
  readonly recordedAt: string;
  readonly expiresAt: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

@Injectable()
export class SourceRuntimeGuardService {
  constructor(
    @Inject(REDIS_CLIENT)
    private readonly redisClient: Redis,
  ) {}

  async inspect(source: SourceAdapterKey): Promise<SourceRuntimeGuardState> {
    const rawValue = await this.redisClient.get(this.buildKey(source));

    if (!rawValue) {
      return {
        source,
        mode: 'active',
        checkedAt: new Date(),
      };
    }

    const parsedValue = JSON.parse(rawValue) as Partial<StoredRuntimeGuardState>;
    const recordedAt = parsedValue.recordedAt
      ? new Date(parsedValue.recordedAt)
      : new Date();
    const expiresAt = parsedValue.expiresAt
      ? new Date(parsedValue.expiresAt)
      : undefined;

    if (
      !parsedValue.mode ||
      !parsedValue.reason ||
      !expiresAt ||
      Number.isNaN(expiresAt.getTime()) ||
      expiresAt.getTime() <= Date.now()
    ) {
      await this.clear(source);

      return {
        source,
        mode: 'active',
        checkedAt: new Date(),
      };
    }

    return {
      source,
      mode: parsedValue.mode,
      checkedAt: recordedAt,
      expiresAt,
      reason: parsedValue.reason,
      ...(parsedValue.details ? { details: parsedValue.details } : {}),
    };
  }

  holdDegraded(input: {
    readonly source: SourceAdapterKey;
    readonly reason: string;
    readonly ttlMs: number;
    readonly details?: Readonly<Record<string, unknown>>;
  }): Promise<void> {
    return this.writeState({
      source: input.source,
      mode: 'degraded',
      reason: input.reason,
      ttlMs: input.ttlMs,
      ...(input.details ? { details: input.details } : {}),
    });
  }

  holdCooldown(input: {
    readonly source: SourceAdapterKey;
    readonly reason: string;
    readonly ttlMs: number;
    readonly details?: Readonly<Record<string, unknown>>;
  }): Promise<void> {
    return this.writeState({
      source: input.source,
      mode: 'cooldown',
      reason: input.reason,
      ttlMs: input.ttlMs,
      ...(input.details ? { details: input.details } : {}),
    });
  }

  disable(input: {
    readonly source: SourceAdapterKey;
    readonly reason: string;
    readonly ttlMs: number;
    readonly details?: Readonly<Record<string, unknown>>;
  }): Promise<void> {
    return this.writeState({
      source: input.source,
      mode: 'disabled',
      reason: input.reason,
      ttlMs: input.ttlMs,
      ...(input.details ? { details: input.details } : {}),
    });
  }

  clear(source: SourceAdapterKey): Promise<void> {
    return this.redisClient.del(this.buildKey(source)).then(() => undefined);
  }

  private async writeState(input: {
    readonly source: SourceAdapterKey;
    readonly mode: Exclude<SourceRuntimeGuardState['mode'], 'active'>;
    readonly reason: string;
    readonly ttlMs: number;
    readonly details?: Readonly<Record<string, unknown>>;
  }): Promise<void> {
    const recordedAt = new Date();
    const expiresAt = new Date(recordedAt.getTime() + input.ttlMs);

    await this.redisClient.set(
      this.buildKey(input.source),
      JSON.stringify({
        mode: input.mode,
        reason: input.reason,
        recordedAt: recordedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        ...(input.details ? { details: input.details } : {}),
      } satisfies StoredRuntimeGuardState),
      'PX',
      Math.max(1, input.ttlMs),
    );
  }

  private buildKey(source: SourceAdapterKey): string {
    return `source:runtime-guard:${source}`;
  }
}
