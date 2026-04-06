import { UserRole } from '@prisma/client';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  buildAccessEntitlements,
  getAccessTierRank,
  isSubscriptionStatusEntitled,
  mapSubscriptionPlanToAccessTier,
  type SubscriptionAccessContext,
} from '../domain/subscription-access.model';
import {
  SUBSCRIPTIONS_REPOSITORY,
  type SubscriptionRecord,
  type SubscriptionsRepository,
} from '../domain/subscriptions.repository';

@Injectable()
export class AccessControlService {
  constructor(
    @Inject(SUBSCRIPTIONS_REPOSITORY)
    private readonly subscriptionsRepository: SubscriptionsRepository,
  ) {}

  async resolveAccessContext(
    userId: string,
  ): Promise<SubscriptionAccessContext> {
    const user = await this.subscriptionsRepository.findUserById(userId);

    if (!user) {
      throw new NotFoundException(`User '${userId}' was not found.`);
    }

    const subscriptions = [
      ...(await this.subscriptionsRepository.listSubscriptionsByUserId(userId)),
    ];
    let selectedSubscription = this.selectCurrentSubscription(subscriptions);

    if (
      !selectedSubscription ||
      !isSubscriptionStatusEntitled(selectedSubscription.status)
    ) {
      selectedSubscription =
        await this.subscriptionsRepository.ensureDefaultFreeSubscription(
          userId,
        );
    }

    const accessTier =
      user.role === UserRole.ADMIN
        ? 'alpha_access'
        : mapSubscriptionPlanToAccessTier(selectedSubscription.plan);

    return {
      userId,
      accessTier,
      subscription: selectedSubscription,
      entitlements: buildAccessEntitlements(accessTier),
    };
  }

  private selectCurrentSubscription(
    subscriptions: readonly SubscriptionRecord[],
  ): SubscriptionRecord | null {
    if (subscriptions.length === 0) {
      return null;
    }

    return [...subscriptions].sort((left, right) => {
      const entitlementDifference =
        Number(isSubscriptionStatusEntitled(right.status)) -
        Number(isSubscriptionStatusEntitled(left.status));

      if (entitlementDifference !== 0) {
        return entitlementDifference;
      }

      const accessTierDifference =
        getAccessTierRank(mapSubscriptionPlanToAccessTier(right.plan)) -
        getAccessTierRank(mapSubscriptionPlanToAccessTier(left.plan));

      if (accessTierDifference !== 0) {
        return accessTierDifference;
      }

      const rightPeriodEnd = right.currentPeriodEnd?.getTime() ?? 0;
      const leftPeriodEnd = left.currentPeriodEnd?.getTime() ?? 0;

      if (rightPeriodEnd !== leftPeriodEnd) {
        return rightPeriodEnd - leftPeriodEnd;
      }

      return right.updatedAt.getTime() - left.updatedAt.getTime();
    })[0]!;
  }
}
