import type { ItemCategory, InternalNotificationType } from '@prisma/client';

import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';

export const ALERTS_REPOSITORY = Symbol('ALERTS_REPOSITORY');

export interface AlertDeliveryChannelsConfig {
  readonly internal: boolean;
  readonly email: boolean;
  readonly webhook: boolean;
  readonly webhookUrl?: string;
}

export interface AlertRuleRecord {
  readonly id: string;
  readonly userId: string;
  readonly userEmail: string | null;
  readonly userDisplayName: string | null;
  readonly watchlistId: string | null;
  readonly watchlistItemId: string | null;
  readonly canonicalItemId: string;
  readonly canonicalDisplayName: string;
  readonly itemVariantId: string;
  readonly variantDisplayName: string;
  readonly category: ItemCategory;
  readonly source: {
    readonly id: string;
    readonly code: SourceAdapterKey;
    readonly name: string;
  } | null;
  readonly minSpread: number;
  readonly minConfidence: number;
  readonly cooldownSeconds: number;
  readonly isActive: boolean;
  readonly channels: AlertDeliveryChannelsConfig;
  readonly lastTriggeredAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface InternalNotificationRecord {
  readonly id: string;
  readonly userId: string;
  readonly alertRuleId: string | null;
  readonly type: InternalNotificationType;
  readonly title: string;
  readonly body: string;
  readonly dedupeKey: string;
  readonly data: Record<string, unknown> | null;
  readonly readAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateAlertRuleInput {
  readonly userId: string;
  readonly itemVariantId: string;
  readonly watchlistId?: string;
  readonly watchlistItemId?: string;
  readonly sourceCode?: SourceAdapterKey;
  readonly minSpread: number;
  readonly minConfidence: number;
  readonly cooldownSeconds: number;
  readonly isActive: boolean;
  readonly channels: AlertDeliveryChannelsConfig;
}

export interface UpdateAlertRuleInput {
  readonly userId: string;
  readonly alertRuleId: string;
  readonly itemVariantId?: string;
  readonly watchlistId?: string | null;
  readonly watchlistItemId?: string | null;
  readonly sourceCode?: SourceAdapterKey | null;
  readonly minSpread?: number;
  readonly minConfidence?: number;
  readonly cooldownSeconds?: number;
  readonly isActive?: boolean;
  readonly channels?: AlertDeliveryChannelsConfig;
}

export interface FindNotificationsInput {
  readonly userId: string;
  readonly unreadOnly: boolean;
  readonly page: number;
  readonly pageSize: number;
}

export interface InternalNotificationsPageRecord {
  readonly total: number;
  readonly items: readonly InternalNotificationRecord[];
}

export interface CreateInternalNotificationInput {
  readonly userId: string;
  readonly alertRuleId?: string | null;
  readonly type: InternalNotificationType;
  readonly title: string;
  readonly body: string;
  readonly dedupeKey: string;
  readonly data?: Record<string, unknown>;
}

export interface FindAlertRulesForEvaluationInput {
  readonly ruleId?: string;
  readonly userId?: string;
  readonly limit?: number;
}

export interface AlertsRepository {
  findAlertRulesByUser(userId: string): Promise<readonly AlertRuleRecord[]>;
  findAlertRuleById(
    userId: string,
    alertRuleId: string,
  ): Promise<AlertRuleRecord | null>;
  createAlertRule(input: CreateAlertRuleInput): Promise<AlertRuleRecord | null>;
  updateAlertRule(input: UpdateAlertRuleInput): Promise<AlertRuleRecord | null>;
  deleteAlertRule(userId: string, alertRuleId: string): Promise<boolean>;
  findAlertRulesForEvaluation(
    input: FindAlertRulesForEvaluationInput,
  ): Promise<readonly AlertRuleRecord[]>;
  updateAlertRuleTriggeredAt(
    alertRuleId: string,
    triggeredAt: Date,
  ): Promise<void>;
  findNotificationByDedupeKey(
    userId: string,
    dedupeKey: string,
  ): Promise<InternalNotificationRecord | null>;
  createInternalNotification(
    input: CreateInternalNotificationInput,
  ): Promise<InternalNotificationRecord>;
  findNotificationsByUser(
    input: FindNotificationsInput,
  ): Promise<InternalNotificationsPageRecord>;
  markNotificationRead(
    userId: string,
    notificationId: string,
  ): Promise<InternalNotificationRecord | null>;
}
