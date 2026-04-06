import { SubscriptionPlan } from '@prisma/client';
import { IsEnum, IsOptional, IsUrl, MaxLength } from 'class-validator';

export const BILLABLE_SUBSCRIPTION_PLANS = [
  SubscriptionPlan.FULL_ACCESS,
  SubscriptionPlan.ALPHA_ACCESS,
] as const;

export class CreateBillingCheckoutSessionDto {
  @IsEnum(BILLABLE_SUBSCRIPTION_PLANS)
  plan!: SubscriptionPlan;

  @IsOptional()
  @IsUrl({
    require_tld: false,
  })
  @MaxLength(500)
  successUrl?: string;

  @IsOptional()
  @IsUrl({
    require_tld: false,
  })
  @MaxLength(500)
  cancelUrl?: string;
}
