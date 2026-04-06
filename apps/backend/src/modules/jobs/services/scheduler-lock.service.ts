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

  private buildLockKey(key: string): string {
    return `scheduler:lock:${key}`;
  }
}
