import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.constants';

@Injectable()
export class SchedulerLockService {
  constructor(
    @Inject(REDIS_CLIENT)
    private readonly redisClient: Redis,
  ) {}

  async acquire(key: string, ttlMs: number): Promise<boolean> {
    const result = await this.redisClient.set(
      this.buildLockKey(key),
      String(Date.now()),
      'PX',
      Math.max(1, ttlMs),
      'NX',
    );

    return result === 'OK';
  }

  async inspect(key: string): Promise<{
    readonly key: string;
    readonly held: boolean;
    readonly ttlMs?: number;
    readonly acquiredAt?: Date;
  }> {
    const lockKey = this.buildLockKey(key);
    const [rawValue, ttlMs] = await Promise.all([
      this.redisClient.get(lockKey),
      this.redisClient.pttl(lockKey),
    ]);

    if (rawValue === null || ttlMs < 0) {
      return {
        key,
        held: false,
      };
    }

    const acquiredAtMs = Number(rawValue);

    return {
      key,
      held: true,
      ...(Number.isFinite(ttlMs) ? { ttlMs } : {}),
      ...(Number.isFinite(acquiredAtMs)
        ? { acquiredAt: new Date(acquiredAtMs) }
        : {}),
    };
  }

  private buildLockKey(key: string): string {
    return `scheduler:lock:${key}`;
  }
}
