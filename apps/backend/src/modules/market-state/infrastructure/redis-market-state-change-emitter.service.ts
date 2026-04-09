import { Inject, Injectable } from '@nestjs/common';

import { AppLoggerService } from '../../../infrastructure/logging/app-logger.service';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import {
  MARKET_STATE_CHANGED_CHANNEL,
  type MarketStateChangedEvent,
  type MarketStateChangeEmitter,
} from '../domain/market-state-change.port';

@Injectable()
export class RedisMarketStateChangeEmitterService
  implements MarketStateChangeEmitter
{
  constructor(
    @Inject(RedisService)
    private readonly redisService: RedisService,
    @Inject(AppLoggerService)
    private readonly logger: AppLoggerService,
  ) {}

  async emitChanged(events: readonly MarketStateChangedEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    try {
      await this.redisService.getClient().publish(
        MARKET_STATE_CHANGED_CHANNEL,
        JSON.stringify({
          emittedAt: new Date().toISOString(),
          events: events.map((event) => ({
            ...event,
            observedAt: event.observedAt.toISOString(),
          })),
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Failed to publish ${events.length} market-state change event(s): ${error instanceof Error ? error.message : 'unknown error'}.`,
        RedisMarketStateChangeEmitterService.name,
      );
    }
  }
}
