import { AlertRuleType, InternalNotificationType } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';
import type {
  AlertDeliveryChannelsConfig,
  AlertRuleRecord,
  AlertsRepository,
  CreateAlertRuleInput,
  CreateInternalNotificationInput,
  FindAlertRulesForEvaluationInput,
  FindNotificationsInput,
  InternalNotificationRecord,
  InternalNotificationsPageRecord,
  UpdateAlertRuleInput,
} from '../domain/alerts.repository';

const alertRuleInclude = {
  user: {
    select: {
      id: true,
      email: true,
      displayName: true,
    },
  },
  source: {
    select: {
      id: true,
      code: true,
      name: true,
    },
  },
  canonicalItem: {
    select: {
      id: true,
      displayName: true,
      category: true,
    },
  },
  itemVariant: {
    select: {
      id: true,
      displayName: true,
      canonicalItemId: true,
    },
  },
} as const;

@Injectable()
export class AlertsRepositoryAdapter implements AlertsRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
  ) {}

  async findAlertRulesByUser(
    userId: string,
  ): Promise<readonly AlertRuleRecord[]> {
    const rules = await this.prismaService.alertRule.findMany({
      where: {
        userId,
      },
      include: alertRuleInclude,
      orderBy: [
        { isActive: 'desc' },
        { updatedAt: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    return rules.map((rule) => this.mapAlertRule(rule));
  }

  async findAlertRuleById(
    userId: string,
    alertRuleId: string,
  ): Promise<AlertRuleRecord | null> {
    const rule = await this.prismaService.alertRule.findFirst({
      where: {
        id: alertRuleId,
        userId,
      },
      include: alertRuleInclude,
    });

    return rule ? this.mapAlertRule(rule) : null;
  }

  async createAlertRule(
    input: CreateAlertRuleInput,
  ): Promise<AlertRuleRecord | null> {
    return this.prismaService.$transaction(async (transaction) => {
      const resolved = await this.resolveRuleDependencies(transaction, {
        userId: input.userId,
        itemVariantId: input.itemVariantId,
        watchlistId: input.watchlistId ?? null,
        watchlistItemId: input.watchlistItemId ?? null,
        sourceCode: input.sourceCode ?? null,
      });

      if (!resolved) {
        return null;
      }

      const rule = await transaction.alertRule.create({
        data: {
          userId: input.userId,
          watchlistId: resolved.watchlistId,
          watchlistItemId: resolved.watchlistItemId,
          sourceId: resolved.sourceId,
          canonicalItemId: resolved.itemVariant.canonicalItemId,
          itemVariantId: resolved.itemVariant.id,
          ruleType: AlertRuleType.SPREAD_ABOVE,
          thresholdValue: input.minSpread,
          confidenceFloor: input.minConfidence,
          cooldownSeconds: input.cooldownSeconds,
          isActive: input.isActive,
          config: this.toAlertConfig(input.channels),
        },
        include: alertRuleInclude,
      });

      return this.mapAlertRule(rule);
    });
  }

  async updateAlertRule(
    input: UpdateAlertRuleInput,
  ): Promise<AlertRuleRecord | null> {
    const existingRule = await this.prismaService.alertRule.findFirst({
      where: {
        id: input.alertRuleId,
        userId: input.userId,
      },
      select: {
        id: true,
        itemVariantId: true,
        watchlistId: true,
        watchlistItemId: true,
        source: {
          select: {
            code: true,
          },
        },
        config: true,
      },
    });

    if (!existingRule) {
      return null;
    }

    return this.prismaService.$transaction(async (transaction) => {
      const resolved = await this.resolveRuleDependencies(transaction, {
        userId: input.userId,
        itemVariantId: input.itemVariantId ?? existingRule.itemVariantId,
        watchlistId:
          input.watchlistId !== undefined
            ? input.watchlistId
            : existingRule.watchlistId,
        watchlistItemId:
          input.watchlistItemId !== undefined
            ? input.watchlistItemId
            : existingRule.watchlistItemId,
        sourceCode:
          input.sourceCode !== undefined
            ? input.sourceCode
            : ((existingRule.source?.code as SourceAdapterKey | undefined) ??
              null),
      });

      if (!resolved) {
        return null;
      }

      const existingChannels = this.parseAlertConfig(existingRule.config);
      const rule = await transaction.alertRule.update({
        where: {
          id: input.alertRuleId,
        },
        data: {
          watchlistId: resolved.watchlistId,
          watchlistItemId: resolved.watchlistItemId,
          sourceId: resolved.sourceId,
          canonicalItemId: resolved.itemVariant.canonicalItemId,
          itemVariantId: resolved.itemVariant.id,
          ...(input.minSpread !== undefined
            ? { thresholdValue: input.minSpread }
            : {}),
          ...(input.minConfidence !== undefined
            ? { confidenceFloor: input.minConfidence }
            : {}),
          ...(input.cooldownSeconds !== undefined
            ? { cooldownSeconds: input.cooldownSeconds }
            : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.channels
            ? { config: this.toAlertConfig(input.channels) }
            : { config: this.toAlertConfig(existingChannels) }),
        },
        include: alertRuleInclude,
      });

      return this.mapAlertRule(rule);
    });
  }

  async deleteAlertRule(userId: string, alertRuleId: string): Promise<boolean> {
    const rule = await this.prismaService.alertRule.findFirst({
      where: {
        id: alertRuleId,
        userId,
      },
      select: {
        id: true,
      },
    });

    if (!rule) {
      return false;
    }

    await this.prismaService.alertRule.delete({
      where: {
        id: alertRuleId,
      },
    });

    return true;
  }

  async findAlertRulesForEvaluation(
    input: FindAlertRulesForEvaluationInput,
  ): Promise<readonly AlertRuleRecord[]> {
    const rules = await this.prismaService.alertRule.findMany({
      where: {
        isActive: true,
        ...(input.ruleId ? { id: input.ruleId } : {}),
        ...(input.userId ? { userId: input.userId } : {}),
      },
      include: alertRuleInclude,
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      ...(input.limit ? { take: input.limit } : {}),
    });

    return rules.map((rule) => this.mapAlertRule(rule));
  }

  async updateAlertRuleTriggeredAt(
    alertRuleId: string,
    triggeredAt: Date,
  ): Promise<void> {
    await this.prismaService.alertRule.update({
      where: {
        id: alertRuleId,
      },
      data: {
        lastTriggeredAt: triggeredAt,
      },
    });
  }

  async findNotificationByDedupeKey(
    userId: string,
    dedupeKey: string,
  ): Promise<InternalNotificationRecord | null> {
    const notification =
      await this.prismaService.internalNotification.findFirst({
        where: {
          userId,
          dedupeKey,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

    return notification ? this.mapNotification(notification) : null;
  }

  async createInternalNotification(
    input: CreateInternalNotificationInput,
  ): Promise<InternalNotificationRecord> {
    const notification = await this.prismaService.internalNotification.create({
      data: {
        userId: input.userId,
        alertRuleId: input.alertRuleId ?? null,
        type: input.type,
        title: input.title,
        body: input.body,
        dedupeKey: input.dedupeKey,
        ...(input.data ? { data: input.data as Prisma.InputJsonValue } : {}),
      },
    });

    return this.mapNotification(notification);
  }

  async findNotificationsByUser(
    input: FindNotificationsInput,
  ): Promise<InternalNotificationsPageRecord> {
    const skip = (input.page - 1) * input.pageSize;
    const where = {
      userId: input.userId,
      ...(input.unreadOnly ? { readAt: null } : {}),
    } as const;
    const [total, notifications] = await Promise.all([
      this.prismaService.internalNotification.count({
        where,
      }),
      this.prismaService.internalNotification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: input.pageSize,
      }),
    ]);

    return {
      total,
      items: notifications.map((notification) =>
        this.mapNotification(notification),
      ),
    };
  }

  async markNotificationRead(
    userId: string,
    notificationId: string,
  ): Promise<InternalNotificationRecord | null> {
    const notification =
      await this.prismaService.internalNotification.findFirst({
        where: {
          id: notificationId,
          userId,
        },
        select: {
          id: true,
        },
      });

    if (!notification) {
      return null;
    }

    const updatedNotification =
      await this.prismaService.internalNotification.update({
        where: {
          id: notificationId,
        },
        data: {
          readAt: new Date(),
        },
      });

    return this.mapNotification(updatedNotification);
  }

  private async resolveRuleDependencies(
    transaction: Prisma.TransactionClient,
    input: {
      readonly userId: string;
      readonly itemVariantId: string;
      readonly watchlistId: string | null;
      readonly watchlistItemId: string | null;
      readonly sourceCode: SourceAdapterKey | null;
    },
  ): Promise<{
    readonly itemVariant: {
      readonly id: string;
      readonly canonicalItemId: string;
    };
    readonly watchlistId: string | null;
    readonly watchlistItemId: string | null;
    readonly sourceId: string | null;
  } | null> {
    const itemVariant = await transaction.itemVariant.findUnique({
      where: {
        id: input.itemVariantId,
      },
      select: {
        id: true,
        canonicalItemId: true,
      },
    });

    if (!itemVariant) {
      return null;
    }

    let resolvedWatchlistId = input.watchlistId;
    let resolvedWatchlistItemId = input.watchlistItemId;

    if (resolvedWatchlistId) {
      const watchlist = await transaction.watchlist.findFirst({
        where: {
          id: resolvedWatchlistId,
          userId: input.userId,
        },
        select: {
          id: true,
        },
      });

      if (!watchlist) {
        return null;
      }
    }

    if (resolvedWatchlistItemId) {
      const watchlistItem = await transaction.watchlistItem.findFirst({
        where: {
          id: resolvedWatchlistItemId,
          watchlist: {
            userId: input.userId,
          },
        },
        select: {
          id: true,
          watchlistId: true,
          itemVariantId: true,
        },
      });

      if (!watchlistItem) {
        return null;
      }

      if (watchlistItem.itemVariantId !== input.itemVariantId) {
        return null;
      }

      if (
        resolvedWatchlistId &&
        watchlistItem.watchlistId !== resolvedWatchlistId
      ) {
        return null;
      }

      resolvedWatchlistId = watchlistItem.watchlistId;
      resolvedWatchlistItemId = watchlistItem.id;
    }

    const source = input.sourceCode
      ? await transaction.source.findUnique({
          where: {
            code: input.sourceCode,
          },
          select: {
            id: true,
          },
        })
      : null;

    if (input.sourceCode && !source) {
      return null;
    }

    return {
      itemVariant,
      watchlistId: resolvedWatchlistId,
      watchlistItemId: resolvedWatchlistItemId,
      sourceId: source?.id ?? null,
    };
  }

  private mapAlertRule(rule: {
    readonly id: string;
    readonly userId: string;
    readonly watchlistId: string | null;
    readonly watchlistItemId: string | null;
    readonly thresholdValue: Prisma.Decimal | null;
    readonly confidenceFloor: Prisma.Decimal | null;
    readonly cooldownSeconds: number;
    readonly isActive: boolean;
    readonly lastTriggeredAt: Date | null;
    readonly createdAt: Date;
    readonly updatedAt: Date;
    readonly config: Prisma.JsonValue | null;
    readonly user: {
      readonly id: string;
      readonly email: string | null;
      readonly displayName: string | null;
    };
    readonly source: {
      readonly id: string;
      readonly code: string;
      readonly name: string;
    } | null;
    readonly canonicalItem: {
      readonly id: string;
      readonly displayName: string;
      readonly category: AlertRuleRecord['category'];
    };
    readonly itemVariant: {
      readonly id: string;
      readonly displayName: string;
      readonly canonicalItemId: string;
    };
  }): AlertRuleRecord {
    return {
      id: rule.id,
      userId: rule.userId,
      userEmail: rule.user.email,
      userDisplayName: rule.user.displayName,
      watchlistId: rule.watchlistId,
      watchlistItemId: rule.watchlistItemId,
      canonicalItemId: rule.canonicalItem.id,
      canonicalDisplayName: rule.canonicalItem.displayName,
      itemVariantId: rule.itemVariant.id,
      variantDisplayName: rule.itemVariant.displayName,
      category: rule.canonicalItem.category,
      source: rule.source
        ? {
            id: rule.source.id,
            code: rule.source.code as SourceAdapterKey,
            name: rule.source.name,
          }
        : null,
      minSpread: this.toNumber(rule.thresholdValue) ?? 0,
      minConfidence: this.toNumber(rule.confidenceFloor) ?? 0,
      cooldownSeconds: rule.cooldownSeconds,
      isActive: rule.isActive,
      channels: this.parseAlertConfig(rule.config),
      lastTriggeredAt: rule.lastTriggeredAt,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
    };
  }

  private parseAlertConfig(
    config: Prisma.JsonValue | null,
  ): AlertDeliveryChannelsConfig {
    const deliveryConfig =
      config &&
      typeof config === 'object' &&
      !Array.isArray(config) &&
      (config as Record<string, unknown>).delivery &&
      typeof (config as Record<string, unknown>).delivery === 'object' &&
      !Array.isArray((config as Record<string, unknown>).delivery)
        ? ((config as Record<string, unknown>).delivery as Record<
            string,
            unknown
          >)
        : {};

    const internal =
      typeof deliveryConfig.internal === 'boolean'
        ? deliveryConfig.internal
        : true;
    const email =
      typeof deliveryConfig.email === 'boolean' ? deliveryConfig.email : false;
    const webhook =
      typeof deliveryConfig.webhook === 'boolean'
        ? deliveryConfig.webhook
        : false;
    const webhookUrl =
      typeof deliveryConfig.webhookUrl === 'string' &&
      deliveryConfig.webhookUrl.length > 0
        ? deliveryConfig.webhookUrl
        : undefined;

    return {
      internal,
      email,
      webhook,
      ...(webhookUrl ? { webhookUrl } : {}),
    };
  }

  private toAlertConfig(
    channels: AlertDeliveryChannelsConfig,
  ): Prisma.InputJsonValue {
    return {
      delivery: {
        internal: channels.internal,
        email: channels.email,
        webhook: channels.webhook,
        ...(channels.webhookUrl ? { webhookUrl: channels.webhookUrl } : {}),
      },
    };
  }

  private mapNotification(notification: {
    readonly id: string;
    readonly userId: string;
    readonly alertRuleId: string | null;
    readonly type: InternalNotificationType;
    readonly title: string;
    readonly body: string;
    readonly dedupeKey: string;
    readonly data: Prisma.JsonValue | null;
    readonly readAt: Date | null;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  }): InternalNotificationRecord {
    return {
      id: notification.id,
      userId: notification.userId,
      alertRuleId: notification.alertRuleId,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      dedupeKey: notification.dedupeKey,
      data:
        notification.data &&
        typeof notification.data === 'object' &&
        !Array.isArray(notification.data)
          ? (notification.data as Record<string, unknown>)
          : null,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
      updatedAt: notification.updatedAt,
    };
  }

  private toNumber(
    value: Prisma.Decimal | null | undefined,
  ): number | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }

    const numericValue = Number(value.toString());

    return Number.isFinite(numericValue) ? numericValue : undefined;
  }
}
