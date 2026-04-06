import type { JobsOptions } from 'bullmq';

export const ALERT_RULE_EVALUATION_QUEUE_NAME = 'evaluate-alert-rules';
export const ALERT_RULE_EVALUATION_QUEUE = Symbol(
  'ALERT_RULE_EVALUATION_QUEUE',
);
export const ALERT_RULE_EVALUATION_JOB_NAME = 'evaluate-alert-rules';

export interface AlertsJobQueue<T> {
  add(
    name: string,
    data: T,
    opts?: JobsOptions,
  ): Promise<{
    id?: string | number;
  }>;
}
