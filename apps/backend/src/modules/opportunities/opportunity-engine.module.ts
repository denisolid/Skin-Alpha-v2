import { Module } from '@nestjs/common';

import { MarketReadModule } from '../market-state/market-read.module';
import { OpportunityAntiFakeService } from './services/opportunity-anti-fake.service';
import { OpportunityEngineService } from './services/opportunity-engine.service';
import { OpportunityEnginePolicyService } from './services/opportunity-engine-policy.service';

@Module({
  imports: [MarketReadModule],
  providers: [
    OpportunityAntiFakeService,
    OpportunityEnginePolicyService,
    OpportunityEngineService,
  ],
  exports: [
    OpportunityAntiFakeService,
    OpportunityEnginePolicyService,
    OpportunityEngineService,
  ],
})
export class OpportunityEngineModule {}
