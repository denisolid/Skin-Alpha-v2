import type { ItemCategory } from '@prisma/client';

import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';

export interface AlertDeliveryChannelsDto {
  readonly internal: boolean;
  readonly email: boolean;
  readonly webhook: boolean;
  readonly webhookUrl?: string;
}

export interface AlertRuleDto {
  readonly id: string;
  readonly watchlistId?: string;
  readonly watchlistItemId?: string;
  readonly canonicalItemId: string;
  readonly canonicalDisplayName: string;
  readonly itemVariantId: string;
  readonly variantDisplayName: string;
  readonly category: ItemCategory;
  readonly source?: {
    readonly id: string;
    readonly code: SourceAdapterKey;
    readonly name: string;
  };
  readonly minSpread: number;
  readonly minConfidence: number;
  readonly cooldownSeconds: number;
  readonly isActive: boolean;
  readonly channels: AlertDeliveryChannelsDto;
  readonly lastTriggeredAt?: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AlertRulesListDto {
  readonly rules: readonly AlertRuleDto[];
}

export interface InternalNotificationDto {
  readonly id: string;
  readonly alertRuleId?: string;
  readonly type: 'alert_rule_triggered';
  readonly title: string;
  readonly body: string;
  readonly data?: Record<string, unknown>;
  readonly readAt?: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface InternalNotificationsListDto {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
  readonly items: readonly InternalNotificationDto[];
}

export interface AlertEvaluationEnqueueResultDto {
  readonly queueName: string;
  readonly enqueued: boolean;
  readonly ruleId?: string;
  readonly userId?: string;
}
