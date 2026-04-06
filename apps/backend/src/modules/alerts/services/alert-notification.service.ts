import { Inject, Injectable } from '@nestjs/common';
import { InternalNotificationType } from '@prisma/client';

import {
  ALERT_EMAIL_CHANNEL,
  ALERT_WEBHOOK_CHANNEL,
  type AlertEmailChannel,
  type AlertWebhookChannel,
} from '../domain/alert-channel.port';
import {
  ALERTS_REPOSITORY,
  type AlertRuleRecord,
  type AlertsRepository,
} from '../domain/alerts.repository';

@Injectable()
export class AlertNotificationService {
  constructor(
    @Inject(ALERTS_REPOSITORY)
    private readonly alertsRepository: AlertsRepository,
    @Inject(ALERT_EMAIL_CHANNEL)
    private readonly alertEmailChannel: AlertEmailChannel,
    @Inject(ALERT_WEBHOOK_CHANNEL)
    private readonly alertWebhookChannel: AlertWebhookChannel,
  ) {}

  async notify(input: {
    readonly alertRule: AlertRuleRecord;
    readonly dedupeKey: string;
    readonly title: string;
    readonly body: string;
    readonly data: Record<string, unknown>;
  }): Promise<void> {
    await this.alertsRepository.createInternalNotification({
      userId: input.alertRule.userId,
      alertRuleId: input.alertRule.id,
      type: InternalNotificationType.ALERT_RULE_TRIGGERED,
      title: input.title,
      body: input.body,
      dedupeKey: input.dedupeKey,
      data: {
        ...input.data,
        channels: input.alertRule.channels,
      },
    });

    const payload = {
      alertRule: input.alertRule,
      title: input.title,
      body: input.body,
      data: input.data,
    };

    if (input.alertRule.channels.email) {
      await this.alertEmailChannel.deliver(payload);
    }

    if (input.alertRule.channels.webhook) {
      await this.alertWebhookChannel.deliver(payload);
    }
  }
}
