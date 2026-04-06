import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import type { AuthUserRecord } from '../../auth/domain/auth.repository';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { SessionAuthGuard } from '../../auth/guards/session-auth.guard';
import { CreateAlertRuleDto } from '../dto/create-alert-rule.dto';
import { EnqueueAlertEvaluationDto } from '../dto/enqueue-alert-evaluation.dto';
import { GetNotificationsQueryDto } from '../dto/get-notifications.query.dto';
import { UpdateAlertRuleDto } from '../dto/update-alert-rule.dto';
import type {
  AlertEvaluationEnqueueResultDto,
  AlertRuleDto,
  AlertRulesListDto,
  InternalNotificationDto,
  InternalNotificationsListDto,
} from '../dto/alert-rule.dto';
import { AlertsService } from '../services/alerts.service';

@Controller('alerts')
@UseGuards(SessionAuthGuard)
export class AlertsController {
  constructor(
    @Inject(AlertsService)
    private readonly alertsService: AlertsService,
  ) {}

  @Get('rules')
  getAlertRules(
    @CurrentUser() user: AuthUserRecord,
  ): Promise<AlertRulesListDto> {
    return this.alertsService.getAlertRules(user);
  }

  @Get('rules/:alertRuleId')
  getAlertRule(
    @Param('alertRuleId', new ParseUUIDPipe({ version: '4' }))
    alertRuleId: string,
    @CurrentUser() user: AuthUserRecord,
  ): Promise<AlertRuleDto> {
    return this.alertsService.getAlertRule(alertRuleId, user);
  }

  @Post('rules')
  createAlertRule(
    @Body() body: CreateAlertRuleDto,
    @CurrentUser() user: AuthUserRecord,
  ): Promise<AlertRuleDto> {
    return this.alertsService.createAlertRule(body, user);
  }

  @Patch('rules/:alertRuleId')
  updateAlertRule(
    @Param('alertRuleId', new ParseUUIDPipe({ version: '4' }))
    alertRuleId: string,
    @Body() body: UpdateAlertRuleDto,
    @CurrentUser() user: AuthUserRecord,
  ): Promise<AlertRuleDto> {
    return this.alertsService.updateAlertRule(alertRuleId, body, user);
  }

  @Delete('rules/:alertRuleId')
  deleteAlertRule(
    @Param('alertRuleId', new ParseUUIDPipe({ version: '4' }))
    alertRuleId: string,
    @CurrentUser() user: AuthUserRecord,
  ): Promise<void> {
    return this.alertsService.deleteAlertRule(alertRuleId, user);
  }

  @Get('notifications')
  getNotifications(
    @Query() query: GetNotificationsQueryDto,
    @CurrentUser() user: AuthUserRecord,
  ): Promise<InternalNotificationsListDto> {
    return this.alertsService.getNotifications(query, user);
  }

  @Patch('notifications/:notificationId/read')
  markNotificationRead(
    @Param('notificationId', new ParseUUIDPipe({ version: '4' }))
    notificationId: string,
    @CurrentUser() user: AuthUserRecord,
  ): Promise<InternalNotificationDto> {
    return this.alertsService.markNotificationRead(notificationId, user);
  }

  @Post('evaluations/run')
  enqueueEvaluation(
    @Body() body: EnqueueAlertEvaluationDto,
    @CurrentUser() user: AuthUserRecord,
  ): Promise<AlertEvaluationEnqueueResultDto> {
    return this.alertsService.enqueueEvaluation(body, user);
  }
}
