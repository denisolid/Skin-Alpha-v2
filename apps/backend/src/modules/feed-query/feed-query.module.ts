import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { OpportunitiesModule } from '../opportunities/opportunities.module';
import { SchemesModule } from '../schemes/schemes.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { SchemeFeedController } from './controllers/scheme-feed.controller';
import { FeedUserOverlayService } from './services/feed-user-overlay.service';
import { SchemeFeedService } from './services/scheme-feed.service';

@Module({
  imports: [AuthModule, SubscriptionsModule, SchemesModule, OpportunitiesModule],
  controllers: [SchemeFeedController],
  providers: [FeedUserOverlayService, SchemeFeedService],
  exports: [FeedUserOverlayService, SchemeFeedService],
})
export class FeedQueryModule {}
