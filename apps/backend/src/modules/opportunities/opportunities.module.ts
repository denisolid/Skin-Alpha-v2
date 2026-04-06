import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { MarketStateModule } from '../market-state/market-state.module';
import { SourceAdaptersModule } from '../source-adapters/source-adapters.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { OpportunitiesController } from './controllers/opportunities.controller';
import { OPPORTUNITIES_REPOSITORY } from './domain/opportunities.repository';
import { OpportunitiesRepositoryAdapter } from './infrastructure/opportunities.repository';
import { OpportunityFeedService } from './services/opportunity-feed.service';
import { OpportunityAntiFakeService } from './services/opportunity-anti-fake.service';
import { OpportunityEnginePolicyService } from './services/opportunity-engine-policy.service';
import { OpportunityRescanService } from './services/opportunity-rescan.service';
import { OpportunityEngineService } from './services/opportunity-engine.service';
import { OpportunitiesService } from './services/opportunities.service';
import { ScannerUniverseAdminOverrideService } from './services/scanner-universe-admin-override.service';
import { ScannerUniversePolicyService } from './services/scanner-universe-policy.service';
import { ScannerUniverseService } from './services/scanner-universe.service';

@Module({
  imports: [
    AuthModule,
    MarketStateModule,
    SourceAdaptersModule,
    SubscriptionsModule,
  ],
  controllers: [OpportunitiesController],
  providers: [
    OpportunitiesService,
    OpportunityFeedService,
    OpportunityAntiFakeService,
    OpportunityEnginePolicyService,
    OpportunityRescanService,
    OpportunityEngineService,
    ScannerUniverseAdminOverrideService,
    ScannerUniversePolicyService,
    ScannerUniverseService,
    {
      provide: OPPORTUNITIES_REPOSITORY,
      useClass: OpportunitiesRepositoryAdapter,
    },
  ],
  exports: [
    OpportunityEngineService,
    OpportunityRescanService,
    ScannerUniverseService,
  ],
})
export class OpportunitiesModule {}
