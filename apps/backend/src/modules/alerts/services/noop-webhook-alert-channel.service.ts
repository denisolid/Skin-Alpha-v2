import { Injectable } from '@nestjs/common';

import type {
  AlertDeliveryPayload,
  AlertWebhookChannel,
} from '../domain/alert-channel.port';

@Injectable()
export class NoopWebhookAlertChannelService implements AlertWebhookChannel {
  async deliver(_payload: AlertDeliveryPayload): Promise<void> {
    return Promise.resolve();
  }
}
