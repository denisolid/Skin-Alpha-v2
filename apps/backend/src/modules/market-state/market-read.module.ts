import { Module } from '@nestjs/common';

import { MarketStateController } from './controllers/market-state.controller';
import { MARKET_READ_REPOSITORY } from './domain/market-read.repository';
import { MarketStateRepositoryAdapter } from './infrastructure/market-state.repository';
import { MarketFreshnessPolicyService } from './services/market-freshness-policy.service';
import { MarketSnapshotService } from './services/market-snapshot.service';
import { MarketSourceConflictService } from './services/market-source-conflict.service';
import { MarketStateMergeService } from './services/market-state-merge.service';
import { MarketStateService } from './services/market-state.service';
import { SourceMarketLinkService } from './services/source-market-link.service';

@Module({
  controllers: [MarketStateController],
  providers: [
    MarketStateService,
    MarketFreshnessPolicyService,
    MarketSnapshotService,
    MarketSourceConflictService,
    SourceMarketLinkService,
    MarketStateMergeService,
    {
      provide: MARKET_READ_REPOSITORY,
      useClass: MarketStateRepositoryAdapter,
    },
  ],
  exports: [
    MarketStateService,
    MarketSnapshotService,
    MarketStateMergeService,
    MarketFreshnessPolicyService,
    MarketSourceConflictService,
  ],
})
export class MarketReadModule {}
