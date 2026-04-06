import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BILLING_SERVICE } from './domain/billing.port';
import { SUBSCRIPTIONS_REPOSITORY } from './domain/subscriptions.repository';
import { SubscriptionsController } from './controllers/subscriptions.controller';
import { SubscriptionsRepositoryAdapter } from './infrastructure/subscriptions.repository';
import { AccessTierGuard } from './guards/access-tier.guard';
import { AccessControlService } from './services/access-control.service';
import { NoopBillingService } from './services/noop-billing.service';
import { SubscriptionsService } from './services/subscriptions.service';

@Module({
  imports: [AuthModule],
  controllers: [SubscriptionsController],
  providers: [
    SubscriptionsService,
    AccessControlService,
    AccessTierGuard,
    {
      provide: SUBSCRIPTIONS_REPOSITORY,
      useClass: SubscriptionsRepositoryAdapter,
    },
    {
      provide: BILLING_SERVICE,
      useClass: NoopBillingService,
    },
  ],
  exports: [SubscriptionsService, AccessControlService, AccessTierGuard],
})
export class SubscriptionsModule {}
