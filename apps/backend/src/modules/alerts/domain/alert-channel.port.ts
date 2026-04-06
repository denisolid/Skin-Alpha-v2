import type { AlertRuleRecord } from './alerts.repository';

export interface AlertDeliveryPayload {
  readonly alertRule: AlertRuleRecord;
  readonly title: string;
  readonly body: string;
  readonly data: Record<string, unknown>;
}

export const ALERT_EMAIL_CHANNEL = Symbol('ALERT_EMAIL_CHANNEL');
export const ALERT_WEBHOOK_CHANNEL = Symbol('ALERT_WEBHOOK_CHANNEL');

export interface AlertEmailChannel {
  deliver(payload: AlertDeliveryPayload): Promise<void>;
}

export interface AlertWebhookChannel {
  deliver(payload: AlertDeliveryPayload): Promise<void>;
}
