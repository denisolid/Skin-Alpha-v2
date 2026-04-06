import type { SubscriptionPlan } from '@prisma/client';

export const BILLING_SERVICE = Symbol('BILLING_SERVICE');

export interface CreateBillingCheckoutSessionInput {
  readonly userId: string;
  readonly email: string | null;
  readonly plan: SubscriptionPlan;
  readonly successUrl?: string | null;
  readonly cancelUrl?: string | null;
}

export interface BillingCheckoutSessionResult {
  readonly provider: 'placeholder';
  readonly status: 'not_configured';
  readonly plan: SubscriptionPlan;
  readonly checkoutUrl: null;
  readonly message: string;
}

export interface BillingService {
  createCheckoutSession(
    input: CreateBillingCheckoutSessionInput,
  ): Promise<BillingCheckoutSessionResult>;
}
