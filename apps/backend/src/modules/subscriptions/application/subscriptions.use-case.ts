import type { AuthUserRecord } from '../../auth/domain/auth.repository';
import type { BillingCheckoutSessionDto } from '../dto/billing-checkout-session.dto';
import type { CreateBillingCheckoutSessionDto } from '../dto/create-billing-checkout-session.dto';
import type { CurrentSubscriptionDto } from '../dto/current-subscription.dto';
import type { PlanCatalogDto } from '../dto/plan-catalog.dto';
import type { SetUserAccessTierDto } from '../dto/set-user-access-tier.dto';

export interface SubscriptionsUseCase {
  getPlanCatalog(): PlanCatalogDto;
  getMySubscription(user: AuthUserRecord): Promise<CurrentSubscriptionDto>;
  createCheckoutSession(
    user: AuthUserRecord,
    input: CreateBillingCheckoutSessionDto,
  ): Promise<BillingCheckoutSessionDto>;
  setUserAccessTier(
    userId: string,
    input: SetUserAccessTierDto,
    adminUser: Pick<AuthUserRecord, 'id' | 'role'>,
  ): Promise<CurrentSubscriptionDto>;
}
