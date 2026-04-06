import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import type { AuthUserRecord } from '../../auth/domain/auth.repository';
import type { AlertsUseCase } from '../application/alerts.use-case';
import {
  ALERTS_REPOSITORY,
  type AlertDeliveryChannelsConfig,
  type AlertRuleRecord,
  type AlertsRepository,
  type InternalNotificationRecord,
} from '../domain/alerts.repository';
import type { CreateAlertRuleDto } from '../dto/create-alert-rule.dto';
import type { EnqueueAlertEvaluationDto } from '../dto/enqueue-alert-evaluation.dto';
import type { GetNotificationsQueryDto } from '../dto/get-notifications.query.dto';
import type { UpdateAlertRuleDto } from '../dto/update-alert-rule.dto';
import type {
  AlertEvaluationEnqueueResultDto,
  AlertRuleDto,
  AlertRulesListDto,
  InternalNotificationDto,
  InternalNotificationsListDto,
} from '../dto/alert-rule.dto';
import { AlertEvaluationQueueService } from './alert-evaluation-queue.service';

const DEFAULT_MIN_SPREAD = 0;
const DEFAULT_MIN_CONFIDENCE = 0.55;
const DEFAULT_COOLDOWN_SECONDS = 60 * 60;
const DEFAULT_NOTIFICATIONS_PAGE = 1;
const DEFAULT_NOTIFICATIONS_PAGE_SIZE = 25;

@Injectable()
export class AlertsService implements AlertsUseCase {
  constructor(
    @Inject(ALERTS_REPOSITORY)
    private readonly alertsRepository: AlertsRepository,
    @Inject(AlertEvaluationQueueService)
    private readonly alertEvaluationQueueService: AlertEvaluationQueueService,
  ) {}

  async getAlertRules(
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<AlertRulesListDto> {
    const rules = await this.alertsRepository.findAlertRulesByUser(user.id);

    return {
      rules: rules.map((rule) => this.toAlertRuleDto(rule)),
    };
  }

  async getAlertRule(
    alertRuleId: string,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<AlertRuleDto> {
    const rule = await this.alertsRepository.findAlertRuleById(
      user.id,
      alertRuleId,
    );

    if (!rule) {
      throw new NotFoundException(`Alert rule '${alertRuleId}' was not found.`);
    }

    return this.toAlertRuleDto(rule);
  }

  async createAlertRule(
    input: CreateAlertRuleDto,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<AlertRuleDto> {
    const channels = this.normalizeChannels(input.channels);
    const rule = await this.alertsRepository.createAlertRule({
      userId: user.id,
      itemVariantId: input.itemVariantId,
      ...(input.watchlistId ? { watchlistId: input.watchlistId } : {}),
      ...(input.watchlistItemId
        ? { watchlistItemId: input.watchlistItemId }
        : {}),
      ...(input.sourceCode ? { sourceCode: input.sourceCode } : {}),
      minSpread: input.minSpread ?? DEFAULT_MIN_SPREAD,
      minConfidence: input.minConfidence ?? DEFAULT_MIN_CONFIDENCE,
      cooldownSeconds: input.cooldownSeconds ?? DEFAULT_COOLDOWN_SECONDS,
      isActive: input.isActive ?? true,
      channels,
    });

    if (!rule) {
      throw new NotFoundException(
        'The requested item, watchlist, watchlist item, or source was not found.',
      );
    }

    return this.toAlertRuleDto(rule);
  }

  async updateAlertRule(
    alertRuleId: string,
    input: UpdateAlertRuleDto,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<AlertRuleDto> {
    const channels = input.channels
      ? this.normalizeChannels(input.channels)
      : undefined;
    const rule = await this.alertsRepository.updateAlertRule({
      userId: user.id,
      alertRuleId,
      ...(input.itemVariantId ? { itemVariantId: input.itemVariantId } : {}),
      ...(input.watchlistId !== undefined
        ? { watchlistId: input.watchlistId || null }
        : {}),
      ...(input.watchlistItemId !== undefined
        ? { watchlistItemId: input.watchlistItemId || null }
        : {}),
      ...(input.sourceCode !== undefined
        ? { sourceCode: input.sourceCode || null }
        : {}),
      ...(input.minSpread !== undefined ? { minSpread: input.minSpread } : {}),
      ...(input.minConfidence !== undefined
        ? { minConfidence: input.minConfidence }
        : {}),
      ...(input.cooldownSeconds !== undefined
        ? { cooldownSeconds: input.cooldownSeconds }
        : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(channels ? { channels } : {}),
    });

    if (!rule) {
      throw new NotFoundException(
        `Alert rule '${alertRuleId}' or one of its linked resources was not found.`,
      );
    }

    return this.toAlertRuleDto(rule);
  }

  async deleteAlertRule(
    alertRuleId: string,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<void> {
    const deleted = await this.alertsRepository.deleteAlertRule(
      user.id,
      alertRuleId,
    );

    if (!deleted) {
      throw new NotFoundException(`Alert rule '${alertRuleId}' was not found.`);
    }
  }

  async getNotifications(
    query: GetNotificationsQueryDto = {},
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<InternalNotificationsListDto> {
    const page = query.page ?? DEFAULT_NOTIFICATIONS_PAGE;
    const pageSize = query.pageSize ?? DEFAULT_NOTIFICATIONS_PAGE_SIZE;
    const notifications = await this.alertsRepository.findNotificationsByUser({
      userId: user.id,
      unreadOnly: query.unreadOnly ?? false,
      page,
      pageSize,
    });

    return {
      page,
      pageSize,
      total: notifications.total,
      totalPages: Math.max(1, Math.ceil(notifications.total / pageSize)),
      items: notifications.items.map((notification) =>
        this.toNotificationDto(notification),
      ),
    };
  }

  async markNotificationRead(
    notificationId: string,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<InternalNotificationDto> {
    const notification = await this.alertsRepository.markNotificationRead(
      user.id,
      notificationId,
    );

    if (!notification) {
      throw new NotFoundException(
        `Notification '${notificationId}' was not found.`,
      );
    }

    return this.toNotificationDto(notification);
  }

  async enqueueEvaluation(
    input: EnqueueAlertEvaluationDto,
    user: Pick<AuthUserRecord, 'id' | 'role'>,
  ): Promise<AlertEvaluationEnqueueResultDto> {
    this.assertAdminUser(user);

    const result = await this.alertEvaluationQueueService.enqueue({
      ...(input.ruleId ? { ruleId: input.ruleId } : {}),
      ...(input.userId ? { userId: input.userId } : {}),
    });

    return {
      queueName: result.queueName,
      enqueued: result.enqueued,
      ...(input.ruleId ? { ruleId: input.ruleId } : {}),
      ...(input.userId ? { userId: input.userId } : {}),
    };
  }

  private normalizeChannels(
    input:
      | {
          readonly internal?: boolean;
          readonly email?: boolean;
          readonly webhook?: boolean;
          readonly webhookUrl?: string;
        }
      | undefined,
  ): AlertDeliveryChannelsConfig {
    const channels = {
      internal: input?.internal ?? true,
      email: input?.email ?? false,
      webhook: input?.webhook ?? false,
      ...(input?.webhookUrl ? { webhookUrl: input.webhookUrl.trim() } : {}),
    };

    if (!channels.internal && !channels.email && !channels.webhook) {
      throw new BadRequestException(
        'At least one alert delivery channel must be enabled.',
      );
    }

    if (channels.webhook && !channels.webhookUrl) {
      throw new BadRequestException(
        'webhookUrl is required when webhook alerts are enabled.',
      );
    }

    return channels;
  }

  private toAlertRuleDto(rule: AlertRuleRecord): AlertRuleDto {
    return {
      id: rule.id,
      ...(rule.watchlistId ? { watchlistId: rule.watchlistId } : {}),
      ...(rule.watchlistItemId
        ? { watchlistItemId: rule.watchlistItemId }
        : {}),
      canonicalItemId: rule.canonicalItemId,
      canonicalDisplayName: rule.canonicalDisplayName,
      itemVariantId: rule.itemVariantId,
      variantDisplayName: rule.variantDisplayName,
      category: rule.category,
      ...(rule.source ? { source: rule.source } : {}),
      minSpread: rule.minSpread,
      minConfidence: rule.minConfidence,
      cooldownSeconds: rule.cooldownSeconds,
      isActive: rule.isActive,
      channels: rule.channels,
      ...(rule.lastTriggeredAt
        ? { lastTriggeredAt: rule.lastTriggeredAt }
        : {}),
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
    };
  }

  private toNotificationDto(
    notification: InternalNotificationRecord,
  ): InternalNotificationDto {
    return {
      id: notification.id,
      ...(notification.alertRuleId
        ? { alertRuleId: notification.alertRuleId }
        : {}),
      type: 'alert_rule_triggered',
      title: notification.title,
      body: notification.body,
      ...(notification.data ? { data: notification.data } : {}),
      ...(notification.readAt ? { readAt: notification.readAt } : {}),
      createdAt: notification.createdAt,
      updatedAt: notification.updatedAt,
    };
  }

  private assertAdminUser(user: Pick<AuthUserRecord, 'role'>): void {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'Administrator role is required to enqueue alert evaluation jobs.',
      );
    }
  }
}
