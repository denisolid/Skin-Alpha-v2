import { Module } from '@nestjs/common';

import { MARKET_STATE_CHANGE_EMITTER } from './domain/market-state-change.port';
import { MARKET_STATE_WRITE_REPOSITORY } from './domain/market-state-write.repository';
import { MarketStateWriteRepositoryAdapter } from './infrastructure/market-state-write.repository';
import { RedisMarketStateChangeEmitterService } from './infrastructure/redis-market-state-change-emitter.service';
import { MarketStateRebuildService } from './services/market-state-rebuild.service';
import { MarketStateUpdaterService } from './services/market-state-updater.service';

@Module({
  providers: [
    MarketStateUpdaterService,
    MarketStateRebuildService,
    RedisMarketStateChangeEmitterService,
    {
      provide: MARKET_STATE_WRITE_REPOSITORY,
      useClass: MarketStateWriteRepositoryAdapter,
    },
    {
      provide: MARKET_STATE_CHANGE_EMITTER,
      useExisting: RedisMarketStateChangeEmitterService,
    },
  ],
  exports: [MarketStateUpdaterService, MarketStateRebuildService],
})
export class MarketStateWriteModule {}
