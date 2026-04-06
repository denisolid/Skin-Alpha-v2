import type { AuthUserRecord } from '../../auth/domain/auth.repository';
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

export interface AlertsUseCase {
  getAlertRules(user: Pick<AuthUserRecord, 'id'>): Promise<AlertRulesListDto>;
  getAlertRule(
    alertRuleId: string,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<AlertRuleDto>;
  createAlertRule(
    input: CreateAlertRuleDto,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<AlertRuleDto>;
  updateAlertRule(
    alertRuleId: string,
    input: UpdateAlertRuleDto,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<AlertRuleDto>;
  deleteAlertRule(
    alertRuleId: string,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<void>;
  getNotifications(
    query: GetNotificationsQueryDto | undefined,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<InternalNotificationsListDto>;
  markNotificationRead(
    notificationId: string,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<InternalNotificationDto>;
  enqueueEvaluation(
    input: EnqueueAlertEvaluationDto,
    user: Pick<AuthUserRecord, 'id' | 'role'>,
  ): Promise<AlertEvaluationEnqueueResultDto>;
}
