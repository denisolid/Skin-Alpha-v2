import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Module, type Provider } from '@nestjs/common';
import type { Queue } from 'bullmq';

import { AuthModule } from '../auth/auth.module';
import { OpportunitiesModule } from '../opportunities/opportunities.module';
import {
  ALERT_EMAIL_CHANNEL,
  ALERT_WEBHOOK_CHANNEL,
} from './domain/alert-channel.port';
import {
  ALERT_RULE_EVALUATION_QUEUE,
  ALERT_RULE_EVALUATION_QUEUE_NAME,
  type AlertsJobQueue,
} from './domain/alert-evaluation.constants';
import { ALERTS_REPOSITORY } from './domain/alerts.repository';
import type { EvaluateAlertRulesJobData } from './dto/evaluate-alert-rules.job.dto';
import { AlertsRepositoryAdapter } from './infrastructure/alerts.repository';
import { AlertRuleEvaluationProcessor } from './infrastructure/processors/alert-rule-evaluation.processor';
import { NoopAlertsJobQueue } from './infrastructure/queues/noop-alerts-job.queue';
import { AlertsController } from './controllers/alerts.controller';
import { AlertEvaluationQueueService } from './services/alert-evaluation-queue.service';
import { AlertNotificationService } from './services/alert-notification.service';
import { AlertRuleEvaluationService } from './services/alert-rule-evaluation.service';
import { AlertsService } from './services/alerts.service';
import { NoopEmailAlertChannelService } from './services/noop-email-alert-channel.service';
import { NoopWebhookAlertChannelService } from './services/noop-webhook-alert-channel.service';
import {
  IS_TEST_ENVIRONMENT,
  RUNS_BACKGROUND_PROCESSORS,
} from '../../infrastructure/runtime/runtime-mode';

const alertQueueImports = IS_TEST_ENVIRONMENT
  ? []
  : [
      BullModule.registerQueue({
        name: ALERT_RULE_EVALUATION_QUEUE_NAME,
        defaultJobOptions: {
          attempts: 3,
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      }),
    ];

const alertQueueProviders: Provider[] = IS_TEST_ENVIRONMENT
  ? [
      {
        provide: ALERT_RULE_EVALUATION_QUEUE,
        useFactory: (): AlertsJobQueue<EvaluateAlertRulesJobData> =>
          new NoopAlertsJobQueue<EvaluateAlertRulesJobData>(),
      },
    ]
  : [
      {
        provide: ALERT_RULE_EVALUATION_QUEUE,
        inject: [getQueueToken(ALERT_RULE_EVALUATION_QUEUE_NAME)],
        useFactory: (
          queue: Queue<EvaluateAlertRulesJobData>,
        ): AlertsJobQueue<EvaluateAlertRulesJobData> => queue,
      },
    ];

const alertQueueWorkerProviders: Provider[] = RUNS_BACKGROUND_PROCESSORS
  ? [AlertRuleEvaluationProcessor]
  : [];

@Module({
  imports: [AuthModule, OpportunitiesModule, ...alertQueueImports],
  controllers: [AlertsController],
  providers: [
    AlertsService,
    AlertEvaluationQueueService,
    AlertRuleEvaluationService,
    AlertNotificationService,
    NoopEmailAlertChannelService,
    NoopWebhookAlertChannelService,
    ...alertQueueProviders,
    ...alertQueueWorkerProviders,
    {
      provide: ALERTS_REPOSITORY,
      useClass: AlertsRepositoryAdapter,
    },
    {
      provide: ALERT_EMAIL_CHANNEL,
      useExisting: NoopEmailAlertChannelService,
    },
    {
      provide: ALERT_WEBHOOK_CHANNEL,
      useExisting: NoopWebhookAlertChannelService,
    },
  ],
})
export class AlertsModule {}
