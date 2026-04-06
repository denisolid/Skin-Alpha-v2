import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';

import type { AuthUserRecord } from '../../auth/domain/auth.repository';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { SessionAuthGuard } from '../../auth/guards/session-auth.guard';
import { RequireAccessTier } from '../decorators/require-access-tier.decorator';
import { AlphaPlaceholderDto } from '../dto/alpha-placeholder.dto';
import { BillingCheckoutSessionDto } from '../dto/billing-checkout-session.dto';
import { CreateBillingCheckoutSessionDto } from '../dto/create-billing-checkout-session.dto';
import { CurrentSubscriptionDto } from '../dto/current-subscription.dto';
import { PlanCatalogDto } from '../dto/plan-catalog.dto';
import { SetUserAccessTierDto } from '../dto/set-user-access-tier.dto';
import { SubscriptionsService } from '../services/subscriptions.service';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(
    @Inject(SubscriptionsService)
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  @Get('plans')
  getPlanCatalog(): PlanCatalogDto {
    return this.subscriptionsService.getPlanCatalog();
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  getMySubscription(
    @CurrentUser() user: AuthUserRecord,
  ): Promise<CurrentSubscriptionDto> {
    return this.subscriptionsService.getMySubscription(user);
  }

  @Post('billing/checkout-session')
  @UseGuards(SessionAuthGuard)
  createCheckoutSession(
    @CurrentUser() user: AuthUserRecord,
    @Body() body: CreateBillingCheckoutSessionDto,
  ): Promise<BillingCheckoutSessionDto> {
    return this.subscriptionsService.createCheckoutSession(user, body);
  }

  @Put('admin/users/:userId/access')
  @UseGuards(SessionAuthGuard)
  setUserAccessTier(
    @Param('userId', new ParseUUIDPipe({ version: '4' }))
    userId: string,
    @CurrentUser() user: AuthUserRecord,
    @Body() body: SetUserAccessTierDto,
  ): Promise<CurrentSubscriptionDto> {
    return this.subscriptionsService.setUserAccessTier(userId, body, user);
  }

  @Get('alpha/placeholder')
  @RequireAccessTier('alpha_access')
  getAlphaPlaceholder(): AlphaPlaceholderDto {
    return this.subscriptionsService.getAlphaPlaceholder();
  }
}
