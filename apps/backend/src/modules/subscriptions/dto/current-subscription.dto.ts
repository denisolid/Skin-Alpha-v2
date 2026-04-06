import type {
  SubscriptionPlan,
  SubscriptionProvider,
  SubscriptionStatus,
} from '@prisma/client';

import type { SubscriptionAccessContext } from '../domain/subscription-access.model';

export class AccessEntitlementsDto {
  readonly limitedFeed: boolean;
  readonly fullFeed: boolean;
  readonly alphaFeatures: boolean;

  constructor(context: SubscriptionAccessContext) {
    this.limitedFeed = context.entitlements.limitedFeed;
    this.fullFeed = context.entitlements.fullFeed;
    this.alphaFeatures = context.entitlements.alphaFeatures;
  }
}

export class SubscriptionRecordDto {
  readonly id: string;
  readonly provider: SubscriptionProvider;
  readonly plan: SubscriptionPlan;
  readonly status: SubscriptionStatus;
  readonly currentPeriodStart: Date | null;
  readonly currentPeriodEnd: Date | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly canceledAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  constructor(context: SubscriptionAccessContext) {
    this.id = context.subscription.id;
    this.provider = context.subscription.provider;
    this.plan = context.subscription.plan;
    this.status = context.subscription.status;
    this.currentPeriodStart = context.subscription.currentPeriodStart;
    this.currentPeriodEnd = context.subscription.currentPeriodEnd;
    this.cancelAtPeriodEnd = context.subscription.cancelAtPeriodEnd;
    this.canceledAt = context.subscription.canceledAt;
    this.createdAt = context.subscription.createdAt;
    this.updatedAt = context.subscription.updatedAt;
  }
}

export class CurrentSubscriptionDto {
  readonly accessTier: SubscriptionAccessContext['accessTier'];
  readonly entitlements: AccessEntitlementsDto;
  readonly subscription: SubscriptionRecordDto;

  constructor(context: SubscriptionAccessContext) {
    this.accessTier = context.accessTier;
    this.entitlements = new AccessEntitlementsDto(context);
    this.subscription = new SubscriptionRecordDto(context);
  }
}
