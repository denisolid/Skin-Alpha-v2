import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { MarketReadModule } from '../market-state/market-read.module';
import { MarketStateWriteModule } from '../market-state/market-state-write.module';
import { OpportunitiesModule } from '../opportunities/opportunities.module';
import { SourceAdaptersModule } from '../source-adapters/source-adapters.module';
import { AdminController } from './controllers/admin.controller';
import { AdminService } from './services/admin.service';

@Module({
  imports: [
    AuthModule,
    CatalogModule,
    MarketReadModule,
    MarketStateWriteModule,
    OpportunitiesModule,
    SourceAdaptersModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
