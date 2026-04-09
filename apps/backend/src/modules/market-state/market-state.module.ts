import { Module } from '@nestjs/common';

import { MarketReadModule } from './market-read.module';
import { MarketStateWriteModule } from './market-state-write.module';

@Module({
  imports: [MarketReadModule, MarketStateWriteModule],
  exports: [MarketReadModule, MarketStateWriteModule],
})
export class MarketStateModule {}
