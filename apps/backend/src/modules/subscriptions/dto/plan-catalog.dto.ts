import type { SubscriptionPlan } from '@prisma/client';

import type { AccessTier } from '../domain/subscription-access.model';

export class PlanCatalogEntryDto {
  readonly accessTier: AccessTier;
  readonly plan: SubscriptionPlan;
  readonly label: string;
  readonly description: string;
  readonly limitedFeed: boolean;
  readonly fullFeed: boolean;
  readonly alphaFeatures: boolean;
  readonly placeholder: boolean;

  constructor(input: {
    accessTier: AccessTier;
    plan: SubscriptionPlan;
    label: string;
    description: string;
    limitedFeed: boolean;
    fullFeed: boolean;
    alphaFeatures: boolean;
    placeholder?: boolean;
  }) {
    this.accessTier = input.accessTier;
    this.plan = input.plan;
    this.label = input.label;
    this.description = input.description;
    this.limitedFeed = input.limitedFeed;
    this.fullFeed = input.fullFeed;
    this.alphaFeatures = input.alphaFeatures;
    this.placeholder = input.placeholder ?? false;
  }
}

export class PlanCatalogDto {
  readonly plans: readonly PlanCatalogEntryDto[];

  constructor(plans: readonly PlanCatalogEntryDto[]) {
    this.plans = plans;
  }
}
