import type { SubscriptionPlan } from '@prisma/client';

import type { BillingCheckoutSessionResult } from '../domain/billing.port';

export class BillingCheckoutSessionDto {
  readonly provider: BillingCheckoutSessionResult['provider'];
  readonly status: BillingCheckoutSessionResult['status'];
  readonly plan: SubscriptionPlan;
  readonly checkoutUrl: null;
  readonly message: string;

  constructor(result: BillingCheckoutSessionResult) {
    this.provider = result.provider;
    this.status = result.status;
    this.plan = result.plan;
    this.checkoutUrl = result.checkoutUrl;
    this.message = result.message;
  }
}
