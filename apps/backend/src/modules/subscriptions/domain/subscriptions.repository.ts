import type {
  Prisma,
  SubscriptionPlan,
  SubscriptionProvider,
  SubscriptionStatus,
} from '@prisma/client';
import type { UserRole } from '@prisma/client';

export const SUBSCRIPTIONS_REPOSITORY = Symbol('SUBSCRIPTIONS_REPOSITORY');

export type SubscriptionRecord = Prisma.SubscriptionGetPayload<object>;

export interface SubscriptionUserRecord {
  readonly id: string;
  readonly email: string | null;
  readonly role: UserRole;
}

export interface CreateManualSubscriptionInput {
  readonly userId: string;
  readonly plan: SubscriptionPlan;
  readonly status: SubscriptionStatus;
  readonly currentPeriodStart?: Date | null;
  readonly currentPeriodEnd?: Date | null;
  readonly cancelAtPeriodEnd?: boolean;
  readonly canceledAt?: Date | null;
  readonly provider?: SubscriptionProvider;
  readonly metadata?: Prisma.InputJsonValue | null;
}

export interface UpdateSubscriptionInput {
  readonly subscriptionId: string;
  readonly plan?: SubscriptionPlan;
  readonly status?: SubscriptionStatus;
  readonly currentPeriodStart?: Date | null;
  readonly currentPeriodEnd?: Date | null;
  readonly cancelAtPeriodEnd?: boolean;
  readonly canceledAt?: Date | null;
  readonly metadata?: Prisma.InputJsonValue | null;
}

export interface SubscriptionsRepository {
  findUserById(userId: string): Promise<SubscriptionUserRecord | null>;
  listSubscriptionsByUserId(
    userId: string,
  ): Promise<readonly SubscriptionRecord[]>;
  findLatestManualSubscriptionByUserId(
    userId: string,
  ): Promise<SubscriptionRecord | null>;
  ensureDefaultFreeSubscription(userId: string): Promise<SubscriptionRecord>;
  createManualSubscription(
    input: CreateManualSubscriptionInput,
  ): Promise<SubscriptionRecord>;
  updateSubscription(
    input: UpdateSubscriptionInput,
  ): Promise<SubscriptionRecord>;
}
