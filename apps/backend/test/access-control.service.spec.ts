import {
  SubscriptionPlan,
  SubscriptionProvider,
  SubscriptionStatus,
  UserRole,
} from '@prisma/client';

import { AccessControlService } from '../src/modules/subscriptions/services/access-control.service';
import type { SubscriptionsRepository } from '../src/modules/subscriptions/domain/subscriptions.repository';

describe('AccessControlService', () => {
  it('grants admin users elevated entitlements regardless of stored plan', async () => {
    const now = new Date('2026-04-06T12:00:00.000Z');
    const repository: SubscriptionsRepository = {
      findUserById: jest.fn().mockResolvedValue({
        id: 'user-admin',
        email: 'admin@example.com',
        role: UserRole.ADMIN,
      }),
      listSubscriptionsByUserId: jest.fn().mockResolvedValue([
        {
          id: 'subscription-free',
          userId: 'user-admin',
          provider: SubscriptionProvider.MANUAL,
          plan: SubscriptionPlan.FREE,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: now,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          canceledAt: null,
          metadata: {},
          createdAt: now,
          updatedAt: now,
        },
      ]),
      findLatestManualSubscriptionByUserId: jest.fn(),
      ensureDefaultFreeSubscription: jest.fn(),
      createManualSubscription: jest.fn(),
      updateSubscription: jest.fn(),
    };
    const service = new AccessControlService(repository);

    const access = await service.resolveAccessContext('user-admin');

    expect(access.accessTier).toBe('alpha_access');
    expect(access.entitlements.fullFeed).toBe(true);
    expect(access.entitlements.alphaFeatures).toBe(true);
  });
});
