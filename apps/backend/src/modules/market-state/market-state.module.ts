import { Module } from '@nestjs/common';

import { MarketStateController } from './controllers/market-state.controller';
import { MARKET_STATE_REPOSITORY } from './domain/market-state.repository';
import { MarketStateRepositoryAdapter } from './infrastructure/market-state.repository';
import { MarketFreshnessPolicyService } from './services/market-freshness-policy.service';
import { MarketStateRebuildService } from './services/market-state-rebuild.service';
import { MarketSnapshotService } from './services/market-snapshot.service';
import { MarketSourceConflictService } from './services/market-source-conflict.service';
import { MarketStateMergeService } from './services/market-state-merge.service';
import { SourceMarketLinkService } from './services/source-market-link.service';
import { MarketStateService } from './services/market-state.service';

@Module({
  controllers: [MarketStateController],
  providers: [
    MarketStateService,
    MarketFreshnessPolicyService,
    MarketStateRebuildService,
    MarketSnapshotService,
    MarketSourceConflictService,
    SourceMarketLinkService,
    MarketStateMergeService,
    {
      provide: MARKET_STATE_REPOSITORY,
      useClass: MarketStateRepositoryAdapter,
    },
  ],
  exports: [
    MarketStateService,
    MarketSnapshotService,
    MarketStateMergeService,
    MarketFreshnessPolicyService,
    MarketStateRebuildService,
  ],
})
export class MarketStateModule {}
