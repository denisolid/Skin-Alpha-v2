import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import {
  ALERTS_REPOSITORY,
  type AlertRuleRecord,
  type AlertsRepository,
} from '../domain/alerts.repository';
import type { EvaluateAlertRulesJobData } from '../dto/evaluate-alert-rules.job.dto';
import type { OpportunityEvaluationDto } from '../../opportunities/dto/opportunity-engine.dto';
import { OpportunityEngineService } from '../../opportunities/services/opportunity-engine.service';
import { AlertNotificationService } from './alert-notification.service';

const ALERT_RULE_EVALUATION_MAX_PAIRS = 40;

@Injectable()
export class AlertRuleEvaluationService {
  constructor(
    @Inject(ALERTS_REPOSITORY)
    private readonly alertsRepository: AlertsRepository,
    @Inject(OpportunityEngineService)
    private readonly opportunityEngineService: OpportunityEngineService,
    @Inject(AlertNotificationService)
    private readonly alertNotificationService: AlertNotificationService,
  ) {}

  async evaluateRules(input: EvaluateAlertRulesJobData = {}): Promise<{
    readonly evaluatedRuleCount: number;
    readonly triggeredRuleCount: number;
  }> {
    const now = new Date();
    const rules = await this.alertsRepository.findAlertRulesForEvaluation({
      ...(input.ruleId ? { ruleId: input.ruleId } : {}),
      ...(input.userId ? { userId: input.userId } : {}),
    });
    let triggeredRuleCount = 0;

    for (const rule of rules) {
      const triggered = await this.evaluateRule(rule, now);

      if (triggered) {
        triggeredRuleCount += 1;
      }
    }

    return {
      evaluatedRuleCount: rules.length,
      triggeredRuleCount,
    };
  }

  private async evaluateRule(
    rule: AlertRuleRecord,
    now: Date,
  ): Promise<boolean> {
    if (
      rule.lastTriggeredAt &&
      now.getTime() - rule.lastTriggeredAt.getTime() <
        rule.cooldownSeconds * 1000
    ) {
      return false;
    }

    const result = await this.opportunityEngineService.evaluateVariant(
      rule.itemVariantId,
      {
        includeRejected: false,
        maxPairs: ALERT_RULE_EVALUATION_MAX_PAIRS,
      },
    );
    const matchingOpportunity = result.evaluations.find((evaluation) =>
      this.matchesRule(rule, evaluation),
    );

    if (!matchingOpportunity) {
      return false;
    }

    const dedupeKey = this.buildDedupeKey(rule, matchingOpportunity);
    const duplicateNotification =
      await this.alertsRepository.findNotificationByDedupeKey(
        rule.userId,
        dedupeKey,
      );

    if (duplicateNotification) {
      return false;
    }

    const title = `Opportunity alert: ${rule.variantDisplayName}`;
    const body = `${matchingOpportunity.buy.sourceName} -> ${matchingOpportunity.sell.sourceName} net ${matchingOpportunity.expectedNetProfit.toFixed(2)} confidence ${matchingOpportunity.finalConfidence.toFixed(2)}`;

    await this.alertNotificationService.notify({
      alertRule: rule,
      dedupeKey,
      title,
      body,
      data: this.buildNotificationData(rule, matchingOpportunity),
    });
    await this.alertsRepository.updateAlertRuleTriggeredAt(rule.id, now);

    return true;
  }

  private matchesRule(
    rule: AlertRuleRecord,
    evaluation: OpportunityEvaluationDto,
  ): boolean {
    if (evaluation.disposition === 'rejected') {
      return false;
    }

    if (evaluation.feesAdjustedSpread < rule.minSpread) {
      return false;
    }

    if (evaluation.finalConfidence < rule.minConfidence) {
      return false;
    }

    if (
      rule.source &&
      evaluation.buy.source !== rule.source.code &&
      evaluation.sell.source !== rule.source.code
    ) {
      return false;
    }

    return true;
  }

  private buildDedupeKey(
    rule: AlertRuleRecord,
    evaluation: OpportunityEvaluationDto,
  ): string {
    const buyIdentity =
      evaluation.buy.snapshotId ??
      `${evaluation.buy.observedAt.toISOString()}:${evaluation.buy.ask ?? evaluation.buy.bid ?? 'na'}`;
    const sellIdentity =
      evaluation.sell.snapshotId ??
      `${evaluation.sell.observedAt.toISOString()}:${evaluation.sell.bid ?? evaluation.sell.ask ?? 'na'}`;

    return createHash('sha256')
      .update(
        [
          rule.id,
          evaluation.itemVariantId,
          evaluation.sourcePairKey,
          buyIdentity,
          sellIdentity,
        ].join(':'),
      )
      .digest('hex');
  }

  private buildNotificationData(
    rule: AlertRuleRecord,
    evaluation: OpportunityEvaluationDto,
  ): Record<string, unknown> {
    return {
      alertRuleId: rule.id,
      canonicalItemId: evaluation.canonicalItemId,
      canonicalDisplayName: evaluation.canonicalDisplayName,
      itemVariantId: evaluation.itemVariantId,
      variantDisplayName: evaluation.variantDisplayName,
      category: evaluation.category,
      sourcePairKey: evaluation.sourcePairKey,
      buy: {
        source: evaluation.buy.source,
        sourceName: evaluation.buy.sourceName,
        ask: evaluation.buy.ask,
        bid: evaluation.buy.bid,
        listedQty: evaluation.buy.listedQty,
        observedAt: evaluation.buy.observedAt.toISOString(),
        fetchMode: evaluation.buy.fetchMode,
        confidence: evaluation.buy.confidence,
      },
      sell: {
        source: evaluation.sell.source,
        sourceName: evaluation.sell.sourceName,
        ask: evaluation.sell.ask,
        bid: evaluation.sell.bid,
        listedQty: evaluation.sell.listedQty,
        observedAt: evaluation.sell.observedAt.toISOString(),
        fetchMode: evaluation.sell.fetchMode,
        confidence: evaluation.sell.confidence,
      },
      rawSpread: evaluation.rawSpread,
      feesAdjustedSpread: evaluation.feesAdjustedSpread,
      expectedNetProfit: evaluation.expectedNetProfit,
      finalConfidence: evaluation.finalConfidence,
      minSpread: rule.minSpread,
      minConfidence: rule.minConfidence,
      reasonCodes: evaluation.reasonCodes,
      riskClass: evaluation.riskClass,
    };
  }
}
