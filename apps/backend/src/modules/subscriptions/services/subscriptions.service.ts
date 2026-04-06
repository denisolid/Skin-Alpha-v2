import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  SubscriptionProvider,
  SubscriptionStatus,
  UserRole,
} from '@prisma/client';

import type { AuthUserRecord } from '../../auth/domain/auth.repository';
import type { SubscriptionsUseCase } from '../application/subscriptions.use-case';
import { BILLING_SERVICE, type BillingService } from '../domain/billing.port';
import { mapSubscriptionPlanToAccessTier } from '../domain/subscription-access.model';
import {
  SUBSCRIPTIONS_REPOSITORY,
  type SubscriptionsRepository,
} from '../domain/subscriptions.repository';
import { AlphaPlaceholderDto } from '../dto/alpha-placeholder.dto';
import { BillingCheckoutSessionDto } from '../dto/billing-checkout-session.dto';
import { CreateBillingCheckoutSessionDto } from '../dto/create-billing-checkout-session.dto';
import { CurrentSubscriptionDto } from '../dto/current-subscription.dto';
import { PlanCatalogDto, PlanCatalogEntryDto } from '../dto/plan-catalog.dto';
import { SetUserAccessTierDto } from '../dto/set-user-access-tier.dto';
import { AccessControlService } from './access-control.service';

@Injectable()
export class SubscriptionsService implements SubscriptionsUseCase {
  constructor(
    @Inject(SUBSCRIPTIONS_REPOSITORY)
    private readonly subscriptionsRepository: SubscriptionsRepository,
    @Inject(BILLING_SERVICE)
    private readonly billingService: BillingService,
    @Inject(AccessControlService)
    private readonly accessControlService: AccessControlService,
  ) {}

  getPlanCatalog(): PlanCatalogDto {
    return new PlanCatalogDto([
      new PlanCatalogEntryDto({
        accessTier: 'free',
        plan: 'FREE',
        label: 'Free',
        description:
          'Limited opportunities feed and public scanner entry point.',
        limitedFeed: true,
        fullFeed: false,
        alphaFeatures: false,
      }),
      new PlanCatalogEntryDto({
        accessTier: 'full_access',
        plan: 'FULL_ACCESS',
        label: 'Full Access',
        description:
          'Authenticated full feed, item detail, and scanner operator views.',
        limitedFeed: true,
        fullFeed: true,
        alphaFeatures: false,
      }),
      new PlanCatalogEntryDto({
        accessTier: 'alpha_access',
        plan: 'ALPHA_ACCESS',
        label: 'Alpha Access',
        description:
          'Reserved placeholder tier for future premium and experimental features.',
        limitedFeed: true,
        fullFeed: true,
        alphaFeatures: true,
        placeholder: true,
      }),
    ]);
  }

  async getMySubscription(
    user: AuthUserRecord,
  ): Promise<CurrentSubscriptionDto> {
    const accessContext = await this.accessControlService.resolveAccessContext(
      user.id,
    );

    return new CurrentSubscriptionDto(accessContext);
  }

  async createCheckoutSession(
    user: AuthUserRecord,
    input: CreateBillingCheckoutSessionDto,
  ): Promise<BillingCheckoutSessionDto> {
    if (input.plan === 'FREE') {
      throw new BadRequestException(
        'Checkout sessions are only relevant for paid or premium access tiers.',
      );
    }

    const result = await this.billingService.createCheckoutSession({
      userId: user.id,
      email: user.email,
      plan: input.plan,
      successUrl: input.successUrl ?? null,
      cancelUrl: input.cancelUrl ?? null,
    });

    return new BillingCheckoutSessionDto(result);
  }

  async setUserAccessTier(
    userId: string,
    input: SetUserAccessTierDto,
    adminUser: Pick<AuthUserRecord, 'id' | 'role'>,
  ): Promise<CurrentSubscriptionDto> {
    this.assertAdminUser(adminUser);

    const targetUser = await this.subscriptionsRepository.findUserById(userId);

    if (!targetUser) {
      throw new NotFoundException(`User '${userId}' was not found.`);
    }

    const now = new Date();
    const manualSubscription =
      await this.subscriptionsRepository.findLatestManualSubscriptionByUserId(
        userId,
      );
    const metadata = {
      managedByUserId: adminUser.id,
      note: input.note ?? null,
      accessTier: mapSubscriptionPlanToAccessTier(input.plan),
      updatedAt: now.toISOString(),
    };

    if (manualSubscription) {
      await this.subscriptionsRepository.updateSubscription({
        subscriptionId: manualSubscription.id,
        plan: input.plan,
        status: input.status ?? SubscriptionStatus.ACTIVE,
        currentPeriodStart: now,
        currentPeriodEnd: input.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
        canceledAt:
          (input.status ?? SubscriptionStatus.ACTIVE) ===
          SubscriptionStatus.CANCELED
            ? now
            : null,
        metadata,
      });
    } else {
      await this.subscriptionsRepository.createManualSubscription({
        userId,
        provider: SubscriptionProvider.MANUAL,
        plan: input.plan,
        status: input.status ?? SubscriptionStatus.ACTIVE,
        currentPeriodStart: now,
        currentPeriodEnd: input.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
        canceledAt:
          (input.status ?? SubscriptionStatus.ACTIVE) ===
          SubscriptionStatus.CANCELED
            ? now
            : null,
        metadata,
      });
    }

    const accessContext =
      await this.accessControlService.resolveAccessContext(userId);

    return new CurrentSubscriptionDto(accessContext);
  }

  getAlphaPlaceholder(): AlphaPlaceholderDto {
    return new AlphaPlaceholderDto();
  }

  private assertAdminUser(user: Pick<AuthUserRecord, 'role'>): void {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'Administrator role is required to manage subscription access.',
      );
    }
  }
}
