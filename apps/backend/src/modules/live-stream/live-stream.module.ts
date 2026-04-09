import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { FeedQueryModule } from '../feed-query/feed-query.module';
import { OpportunitiesModule } from '../opportunities/opportunities.module';
import { SchemesModule } from '../schemes/schemes.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { LiveStreamController } from './controllers/live-stream.controller';
import { LiveStreamService } from './services/live-stream.service';

@Module({
  imports: [
    AuthModule,
    SubscriptionsModule,
    SchemesModule,
    OpportunitiesModule,
    FeedQueryModule,
  ],
  controllers: [LiveStreamController],
  providers: [LiveStreamService],
  exports: [LiveStreamService],
})
export class LiveStreamModule {}
