import { Injectable } from '@nestjs/common';

import type {
  BillingCheckoutSessionResult,
  BillingService,
  CreateBillingCheckoutSessionInput,
} from '../domain/billing.port';

@Injectable()
export class NoopBillingService implements BillingService {
  createCheckoutSession(
    input: CreateBillingCheckoutSessionInput,
  ): Promise<BillingCheckoutSessionResult> {
    return Promise.resolve({
      provider: 'placeholder',
      status: 'not_configured',
      plan: input.plan,
      checkoutUrl: null,
      message:
        'Billing provider integration is not configured yet. This placeholder keeps the billing boundary explicit.',
    });
  }
}
