import { Injectable } from '@nestjs/common';

import type {
  AlertDeliveryPayload,
  AlertEmailChannel,
} from '../domain/alert-channel.port';

@Injectable()
export class NoopEmailAlertChannelService implements AlertEmailChannel {
  async deliver(_payload: AlertDeliveryPayload): Promise<void> {
    return Promise.resolve();
  }
}
