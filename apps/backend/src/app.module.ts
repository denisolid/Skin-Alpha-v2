import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';

import { AlertsModule } from './modules/alerts/alerts.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { DiagnosticsModule } from './modules/diagnostics/diagnostics.module';
import { FeedQueryModule } from './modules/feed-query/feed-query.module';
import { HealthModule } from './modules/health/health.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { LiveStreamModule } from './modules/live-stream/live-stream.module';
import { MarketStateModule } from './modules/market-state/market-state.module';
import { OpportunitiesModule } from './modules/opportunities/opportunities.module';
import { SchemesModule } from './modules/schemes/schemes.module';
import { SourceAdaptersModule } from './modules/source-adapters/source-adapters.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { UsersModule } from './modules/users/users.module';
import { WatchlistsModule } from './modules/watchlists/watchlists.module';
import { AppConfigModule } from './infrastructure/config/config.module';
import { BullMqModule } from './infrastructure/bullmq/bullmq.module';
import { GlobalExceptionFilter } from './infrastructure/http/filters/global-exception.filter';
import { RequestIdMiddleware } from './infrastructure/http/middleware/request-id.middleware';
import { AppValidationPipe } from './infrastructure/http/pipes/app-validation.pipe';
import { LoggingModule } from './infrastructure/logging/logging.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';

@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    PrismaModule,
    RedisModule,
    BullMqModule.register(),
    AdminModule,
    HealthModule,
    AuthModule,
    SubscriptionsModule,
    UsersModule,
    SourceAdaptersModule,
    CatalogModule,
    MarketStateModule,
    OpportunitiesModule,
    SchemesModule,
    FeedQueryModule,
    LiveStreamModule,
    WatchlistsModule,
    AlertsModule,
    DiagnosticsModule,
    JobsModule,
  ],
  providers: [
    RequestIdMiddleware,
    {
      provide: APP_PIPE,
      useClass: AppValidationPipe,
    },
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes({
      path: '(.*)',
      method: RequestMethod.ALL,
    });
  }
}
