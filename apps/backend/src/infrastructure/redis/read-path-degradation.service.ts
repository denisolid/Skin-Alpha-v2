import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { REDIS_CLIENT } from './redis.constants';

const DEFAULT_READ_PATH_DEGRADED_TTL_MS = 15 * 60 * 1000;
const READ_PATH_DEGRADED_KEY = 'circuit:read-path-degraded';

interface ReadPathDegradationState {
  readonly reason: string;
  readonly trippedAt: string;
  readonly details?: Record<string, unknown>;
}

@Injectable()
export class ReadPathDegradationService {
  private readonly logger = new Logger(ReadPathDegradationService.name);

  constructor(
    @Inject(REDIS_CLIENT)
    private readonly redisClient: Redis,
  ) {}

  async trip(input: {
    readonly reason: string;
    readonly ttlMs?: number;
    readonly details?: Record<string, unknown>;
  }): Promise<void> {
    const state: ReadPathDegradationState = {
      reason: input.reason,
      trippedAt: new Date().toISOString(),
      ...(input.details ? { details: input.details } : {}),
    };

    try {
      await this.redisClient.set(
        READ_PATH_DEGRADED_KEY,
        JSON.stringify(state),
        'PX',
        Math.max(1, input.ttlMs ?? DEFAULT_READ_PATH_DEGRADED_TTL_MS),
      );
    } catch (error) {
      this.logger.warn(
        `Failed to trip read-path degradation breaker: ${error instanceof Error ? error.message : 'unknown_error'}.`,
      );
    }
  }

  async inspect(): Promise<{
    readonly held: boolean;
    readonly ttlMs?: number;
    readonly state?: {
      readonly reason: string;
      readonly trippedAt?: Date;
      readonly details?: Record<string, unknown>;
    };
  }> {
    try {
      const [rawValue, ttlMs] = await Promise.all([
        this.redisClient.get(READ_PATH_DEGRADED_KEY),
        this.redisClient.pttl(READ_PATH_DEGRADED_KEY),
      ]);

      if (rawValue === null || ttlMs < 0) {
        return {
          held: false,
        };
      }

      const parsedState = this.parseState(rawValue);

      return {
        held: true,
        ...(Number.isFinite(ttlMs) ? { ttlMs } : {}),
        ...(parsedState ? { state: parsedState } : {}),
      };
    } catch (error) {
      this.logger.warn(
        `Failed to inspect read-path degradation breaker: ${error instanceof Error ? error.message : 'unknown_error'}.`,
      );

      return {
        held: false,
      };
    }
  }

  async clear(): Promise<void> {
    try {
      await this.redisClient.del(READ_PATH_DEGRADED_KEY);
    } catch (error) {
      this.logger.warn(
        `Failed to clear read-path degradation breaker: ${error instanceof Error ? error.message : 'unknown_error'}.`,
      );
    }
  }

  private parseState(rawValue: string): {
    readonly reason: string;
    readonly trippedAt?: Date;
    readonly details?: Record<string, unknown>;
  } | null {
    try {
      const parsed = JSON.parse(rawValue) as Partial<ReadPathDegradationState>;

      if (typeof parsed.reason !== 'string' || parsed.reason.length === 0) {
        return null;
      }

      return {
        reason: parsed.reason,
        ...(typeof parsed.trippedAt === 'string'
          ? { trippedAt: new Date(parsed.trippedAt) }
          : {}),
        ...(parsed.details &&
        typeof parsed.details === 'object' &&
        !Array.isArray(parsed.details)
          ? { details: parsed.details }
          : {}),
      };
    } catch {
      return null;
    }
  }
}
