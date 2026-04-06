import type { SubscriptionPlan, SubscriptionStatus } from '@prisma/client';

import type { SubscriptionRecord } from './subscriptions.repository';

export const ACCESS_TIERS = ['free', 'full_access', 'alpha_access'] as const;

export type AccessTier = (typeof ACCESS_TIERS)[number];

export const REQUIRED_ACCESS_TIER_METADATA_KEY =
  'subscriptions:required-access-tier';

export interface AccessEntitlements {
  readonly limitedFeed: boolean;
  readonly fullFeed: boolean;
  readonly alphaFeatures: boolean;
}

export interface SubscriptionAccessContext {
  readonly userId: string;
  readonly accessTier: AccessTier;
  readonly subscription: SubscriptionRecord;
  readonly entitlements: AccessEntitlements;
}

export function mapSubscriptionPlanToAccessTier(
  plan: SubscriptionPlan,
): AccessTier {
  switch (plan) {
    case 'FREE':
      return 'free';
    case 'FULL_ACCESS':
      return 'full_access';
    case 'ALPHA_ACCESS':
      return 'alpha_access';
  }
}

export function getAccessTierRank(accessTier: AccessTier): number {
  switch (accessTier) {
    case 'free':
      return 0;
    case 'full_access':
      return 1;
    case 'alpha_access':
      return 2;
  }
}

export function buildAccessEntitlements(
  accessTier: AccessTier,
): AccessEntitlements {
  return {
    limitedFeed: true,
    fullFeed: getAccessTierRank(accessTier) >= getAccessTierRank('full_access'),
    alphaFeatures:
      getAccessTierRank(accessTier) >= getAccessTierRank('alpha_access'),
  };
}

export function canAccessTier(
  grantedTier: AccessTier,
  requiredTier: AccessTier,
): boolean {
  return getAccessTierRank(grantedTier) >= getAccessTierRank(requiredTier);
}

export function isSubscriptionStatusEntitled(
  status: SubscriptionStatus,
): boolean {
  return status === 'ACTIVE' || status === 'TRIALING';
}
