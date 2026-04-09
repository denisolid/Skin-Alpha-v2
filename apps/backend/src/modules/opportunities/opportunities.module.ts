import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { MarketReadModule } from '../market-state/market-read.module';
import { SourceAdaptersModule } from '../source-adapters/source-adapters.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { OpportunitiesController } from './controllers/opportunities.controller';
import { OPPORTUNITIES_REPOSITORY } from './domain/opportunities.repository';
import { OpportunitiesRepositoryAdapter } from './infrastructure/opportunities.repository';
import { OpportunityEngineModule } from './opportunity-engine.module';
import { OpportunityFeedService } from './services/opportunity-feed.service';
import { OpportunityRescanService } from './services/opportunity-rescan.service';
import { OpportunitiesService } from './services/opportunities.service';
import { ScannerUniverseAdminOverrideService } from './services/scanner-universe-admin-override.service';
import { ScannerUniversePolicyService } from './services/scanner-universe-policy.service';
import { ScannerUniverseService } from './services/scanner-universe.service';

@Module({
  imports: [
    AuthModule,
    MarketReadModule,
    OpportunityEngineModule,
    SourceAdaptersModule,
    SubscriptionsModule,
  ],
  controllers: [OpportunitiesController],
  providers: [
    OpportunitiesService,
    OpportunityFeedService,
    OpportunityRescanService,
    ScannerUniverseAdminOverrideService,
    ScannerUniversePolicyService,
    ScannerUniverseService,
    {
      provide: OPPORTUNITIES_REPOSITORY,
      useClass: OpportunitiesRepositoryAdapter,
    },
  ],
  exports: [
    OpportunityFeedService,
    OpportunityEngineModule,
    OpportunityRescanService,
    ScannerUniverseService,
  ],
})
export class OpportunitiesModule {}
