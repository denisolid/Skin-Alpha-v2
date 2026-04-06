import { Inject, Injectable } from '@nestjs/common';

import {
  ALERT_RULE_EVALUATION_JOB_NAME,
  ALERT_RULE_EVALUATION_QUEUE,
  ALERT_RULE_EVALUATION_QUEUE_NAME,
  type AlertsJobQueue,
} from '../domain/alert-evaluation.constants';
import type { EvaluateAlertRulesJobData } from '../dto/evaluate-alert-rules.job.dto';

@Injectable()
export class AlertEvaluationQueueService {
  constructor(
    @Inject(ALERT_RULE_EVALUATION_QUEUE)
    private readonly alertEvaluationQueue: AlertsJobQueue<EvaluateAlertRulesJobData>,
  ) {}

  async enqueue(input: EvaluateAlertRulesJobData): Promise<{
    readonly queueName: string;
    readonly enqueued: boolean;
    readonly jobId?: string;
  }> {
    const job = await this.alertEvaluationQueue.add(
      ALERT_RULE_EVALUATION_JOB_NAME,
      input,
      {
        attempts: 3,
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );

    return {
      queueName: ALERT_RULE_EVALUATION_QUEUE_NAME,
      enqueued: true,
      ...(job.id !== undefined ? { jobId: String(job.id) } : {}),
    };
  }
}
