import {
  Prisma,
  SubscriptionPlan,
  SubscriptionProvider,
  SubscriptionStatus,
} from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  CreateManualSubscriptionInput,
  SubscriptionRecord,
  SubscriptionUserRecord,
  SubscriptionsRepository,
  UpdateSubscriptionInput,
} from '../domain/subscriptions.repository';

@Injectable()
export class SubscriptionsRepositoryAdapter implements SubscriptionsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findUserById(userId: string): Promise<SubscriptionUserRecord | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
      },
    });
  }

  listSubscriptionsByUserId(
    userId: string,
  ): Promise<readonly SubscriptionRecord[]> {
    return this.prisma.subscription.findMany({
      where: { userId },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  findLatestManualSubscriptionByUserId(
    userId: string,
  ): Promise<SubscriptionRecord | null> {
    return this.prisma.subscription.findFirst({
      where: {
        userId,
        provider: SubscriptionProvider.MANUAL,
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async ensureDefaultFreeSubscription(
    userId: string,
  ): Promise<SubscriptionRecord> {
    const existingManualFreeSubscription =
      await this.prisma.subscription.findFirst({
        where: {
          userId,
          provider: SubscriptionProvider.MANUAL,
          plan: SubscriptionPlan.FREE,
          status: SubscriptionStatus.ACTIVE,
        },
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      });

    if (existingManualFreeSubscription) {
      return existingManualFreeSubscription;
    }

    return this.prisma.subscription.create({
      data: {
        userId,
        provider: SubscriptionProvider.MANUAL,
        plan: SubscriptionPlan.FREE,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: new Date(),
        metadata: {
          source: 'default-free-access',
        },
      },
    });
  }

  createManualSubscription(
    input: CreateManualSubscriptionInput,
  ): Promise<SubscriptionRecord> {
    return this.prisma.subscription.create({
      data: {
        userId: input.userId,
        provider: input.provider ?? SubscriptionProvider.MANUAL,
        plan: input.plan,
        status: input.status,
        currentPeriodStart: input.currentPeriodStart ?? null,
        currentPeriodEnd: input.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
        canceledAt: input.canceledAt ?? null,
        ...(input.metadata !== undefined && input.metadata !== null
          ? { metadata: input.metadata }
          : {}),
      },
    });
  }

  updateSubscription(
    input: UpdateSubscriptionInput,
  ): Promise<SubscriptionRecord> {
    const data: Prisma.SubscriptionUpdateInput = {
      ...(input.plan ? { plan: input.plan } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.currentPeriodStart !== undefined
        ? { currentPeriodStart: input.currentPeriodStart }
        : {}),
      ...(input.currentPeriodEnd !== undefined
        ? { currentPeriodEnd: input.currentPeriodEnd }
        : {}),
      ...(input.cancelAtPeriodEnd !== undefined
        ? { cancelAtPeriodEnd: input.cancelAtPeriodEnd }
        : {}),
      ...(input.canceledAt !== undefined
        ? { canceledAt: input.canceledAt }
        : {}),
      ...(input.metadata !== undefined && input.metadata !== null
        ? { metadata: input.metadata }
        : {}),
    };

    return this.prisma.subscription.update({
      where: { id: input.subscriptionId },
      data,
    });
  }
}
