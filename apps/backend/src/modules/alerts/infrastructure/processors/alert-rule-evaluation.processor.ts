import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import type { Job } from 'bullmq';

import { ALERT_RULE_EVALUATION_QUEUE_NAME } from '../../domain/alert-evaluation.constants';
import type { EvaluateAlertRulesJobData } from '../../dto/evaluate-alert-rules.job.dto';
import { AlertRuleEvaluationService } from '../../services/alert-rule-evaluation.service';

@Processor(ALERT_RULE_EVALUATION_QUEUE_NAME)
export class AlertRuleEvaluationProcessor extends WorkerHost {
  constructor(
    @Inject(AlertRuleEvaluationService)
    private readonly alertRuleEvaluationService: AlertRuleEvaluationService,
  ) {
    super();
  }

  async process(job: Job<EvaluateAlertRulesJobData>): Promise<void> {
    await this.alertRuleEvaluationService.evaluateRules(job.data);
  }
}
