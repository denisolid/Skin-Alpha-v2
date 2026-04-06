import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { MarketStateModule } from '../market-state/market-state.module';
import { OpportunitiesModule } from '../opportunities/opportunities.module';
import { SourceAdaptersModule } from '../source-adapters/source-adapters.module';
import { AdminController } from './controllers/admin.controller';
import { AdminService } from './services/admin.service';

@Module({
  imports: [
    AuthModule,
    CatalogModule,
    MarketStateModule,
    OpportunitiesModule,
    SourceAdaptersModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
