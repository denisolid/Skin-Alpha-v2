import type { JobsOptions } from 'bullmq';

import type { AlertsJobQueue } from '../../domain/alert-evaluation.constants';

export class NoopAlertsJobQueue<T> implements AlertsJobQueue<T> {
  add(
    _name: string,
    _data: T,
    _opts?: JobsOptions,
  ): Promise<{
    id?: string;
  }> {
    return Promise.resolve({
      id: 'noop',
    });
  }
}
