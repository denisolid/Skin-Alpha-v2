import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { MarketReadModule } from '../market-state/market-read.module';
import { OpportunitiesModule } from '../opportunities/opportunities.module';
import { DiagnosticsController } from './controllers/diagnostics.controller';
import { DIAGNOSTICS_REPOSITORY } from './domain/diagnostics.repository';
import { DiagnosticsRepositoryAdapter } from './infrastructure/diagnostics.repository';
import { DiagnosticsService } from './services/diagnostics.service';

@Module({
  imports: [AuthModule, MarketReadModule, OpportunitiesModule],
  controllers: [DiagnosticsController],
  providers: [
    DiagnosticsService,
    {
      provide: DIAGNOSTICS_REPOSITORY,
      useClass: DiagnosticsRepositoryAdapter,
    },
  ],
})
export class DiagnosticsModule {}
