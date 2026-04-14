import { ItemCategory } from '@prisma/client';
import { Injectable } from '@nestjs/common';

import type {
  MergedMarketMatrixDto,
  MergedMarketMatrixRowDto,
} from '../../market-state/dto/merged-market-matrix.dto';
import {
  OPPORTUNITY_CATEGORY_POLICIES,
  OPPORTUNITY_SOURCE_EXECUTION_POLICIES,
} from '../domain/opportunity-engine-policy.model';
import type { AntiFakeAssessment } from '../domain/anti-fake.model';
import type {
  OpportunityEvaluationDisposition,
  OpportunityEngineRiskClass,
  OpportunityBlockerReason,
  OpportunityRiskReasonCode,
  OpportunityRiskReasonSeverity,
  OpportunityReasonCode,
  OpportunitySurfaceTier,
} from '../domain/opportunity-engine.model';
import type {
  OpportunityComponentScoresDto,
  OpportunityEligibilityDto,
  OpportunityExecutionBreakdownDto,
  OpportunityPenaltyBreakdownDto,
  OpportunityPreScoreGateDto,
  OpportunityRiskReasonDto,
  OpportunityStrictTradableMatchDto,
} from '../dto/opportunity-engine.dto';

interface OpportunityClassificationInput {
  readonly category: ItemCategory;
  readonly expectedNetProfit: number;
  readonly rawSpreadPercent: number;
  readonly postFeeEdgeStatus: 'positive' | 'near_equal' | 'non_positive';
  readonly finalConfidence: number;
  readonly antiFakeAssessment: AntiFakeAssessment;
  readonly penalties: OpportunityPenaltyBreakdownDto;
  readonly reasonCodes: readonly OpportunityReasonCode[];
}

@Injectable()
export class OpportunityEnginePolicyService {
  getSellFeeRate(source: MergedMarketMatrixRowDto['source']): number {
    return OPPORTUNITY_SOURCE_EXECUTION_POLICIES[source].sellFeeRate;
  }

  getBuyFeeRate(source: MergedMarketMatrixRowDto['source']): number {
    return OPPORTUNITY_SOURCE_EXECUTION_POLICIES[source].buyFeeRate;
  }

  getExpectedExitPrice(
    category: ItemCategory,
    row: Pick<MergedMarketMatrixRowDto, 'source' | 'ask' | 'bid'>,
  ): number | null {
    if (row.bid !== undefined) {
      return row.bid;
    }

    if (row.ask === undefined) {
      return null;
    }

    const categoryPenalty =
      OPPORTUNITY_CATEGORY_POLICIES[category].baseCategoryPenalty;
    const executionPolicy = OPPORTUNITY_SOURCE_EXECUTION_POLICIES[row.source];
    const executionDiscountRate = Math.min(
      0.12,
      executionPolicy.askExitDiscountRate + categoryPenalty * 0.35,
    );

    return this.roundCurrency(row.ask * (1 - executionDiscountRate));
  }

  buildPenalties(input: {
    readonly category: ItemCategory;
    readonly matrix: MergedMarketMatrixDto;
    readonly buyRow: MergedMarketMatrixRowDto;
    readonly sellRow: MergedMarketMatrixRowDto;
    readonly expectedExitPrice: number;
    readonly backupConfirmationBoost: number;
  }): OpportunityPenaltyBreakdownDto {
    const freshnessPenalty = this.roundRatio(
      this.computeFreshnessPenalty(input.buyRow, input.sellRow),
    );
    const liquidityPenalty = this.roundRatio(
      this.computeLiquidityPenalty(
        input.category,
        input.buyRow,
        input.sellRow,
        input.expectedExitPrice,
      ),
    );
    const stalePenalty = this.roundRatio(
      this.computeStalePenalty(input.buyRow, input.sellRow),
    );
    const categoryPenalty = this.roundRatio(
      OPPORTUNITY_CATEGORY_POLICIES[input.category].baseCategoryPenalty,
    );
    const sourceDisagreementPenalty = this.roundRatio(
      this.computeSourceDisagreementPenalty(
        input.matrix,
        input.buyRow,
        input.sellRow,
      ),
    );
    const totalPenalty = this.roundRatio(
      freshnessPenalty +
        liquidityPenalty +
        stalePenalty +
        categoryPenalty +
        sourceDisagreementPenalty,
    );

    return {
      freshnessPenalty,
      liquidityPenalty,
      stalePenalty,
      categoryPenalty,
      sourceDisagreementPenalty,
      backupConfirmationBoost: this.roundRatio(input.backupConfirmationBoost),
      totalPenalty,
    };
  }

  buildComponentScores(input: {
    readonly matrix: MergedMarketMatrixDto;
    readonly buyRow: MergedMarketMatrixRowDto;
    readonly sellRow: MergedMarketMatrixRowDto;
    readonly penalties: OpportunityPenaltyBreakdownDto;
    readonly antiFakeAssessment: AntiFakeAssessment;
    readonly preScoreGate: OpportunityPreScoreGateDto;
    readonly backupConfirmationBoost: number;
  }): OpportunityComponentScoresDto & {
    readonly finalConfidence: number;
  } {
    const mappingConfidence = this.roundRatio(
      input.matrix.variantIdentity.mappingConfidence,
    );
    const priceConfidence = this.roundRatio(
      Math.max(
        0.05,
        1 -
          input.penalties.sourceDisagreementPenalty * 1.6 -
          (input.preScoreGate.rejectedByMedian ? 0.42 : 0) -
          (input.preScoreGate.rejectedByConsensus ? 0.38 : 0) -
          (input.preScoreGate.rejectedByComparableCount ? 0.18 : 0) +
          input.backupConfirmationBoost * 0.8,
      ),
    );
    const liquidityConfidence = this.roundRatio(
      Math.max(0.05, 1 - input.penalties.liquidityPenalty * 2.55),
    );
    const freshnessConfidence = this.roundRatio(
      Math.max(
        0.05,
        1 -
          (input.penalties.freshnessPenalty + input.penalties.stalePenalty) *
            3.1,
      ),
    );
    const sourceReliabilityConfidence = this.roundRatio(
      Math.sqrt(
        Math.max(0, input.buyRow.sourceConfidence) *
          Math.max(0, input.sellRow.sourceConfidence),
      ) *
        (input.buyRow.agreementState === 'conflicted' ||
        input.sellRow.agreementState === 'conflicted'
          ? 0.76
          : input.buyRow.agreementState === 'divergent' ||
              input.sellRow.agreementState === 'divergent'
            ? 0.9
            : 1),
    );
    const variantMatchConfidence = this.roundRatio(
      input.antiFakeAssessment.matchConfidence,
    );
    const rawComposite =
      mappingConfidence * 0.18 +
      priceConfidence * 0.22 +
      liquidityConfidence * 0.17 +
      freshnessConfidence * 0.14 +
      sourceReliabilityConfidence * 0.14 +
      variantMatchConfidence * 0.15;
    const finalConfidence = this.roundRatio(
      rawComposite *
        Math.max(0.3, 1 - input.penalties.totalPenalty * 0.35) *
        Math.max(0.42, 1 - input.antiFakeAssessment.riskScore * 0.24) +
        input.antiFakeAssessment.confirmationScore * 0.04 +
        input.backupConfirmationBoost * 0.4,
    );

    return {
      mappingConfidence,
      priceConfidence,
      liquidityConfidence,
      freshnessConfidence,
      sourceReliabilityConfidence,
      variantMatchConfidence,
      finalConfidence,
    };
  }

  buildExecutionBreakdown(input: {
    readonly category: ItemCategory;
    readonly buyRow: MergedMarketMatrixRowDto;
    readonly sellRow: MergedMarketMatrixRowDto;
    readonly buyPrice: number;
    readonly realizedSellPrice: number;
    readonly buyFeeRate: number;
    readonly sellFeeRate: number;
    readonly penalties: OpportunityPenaltyBreakdownDto;
    readonly antiFakeAssessment: AntiFakeAssessment;
    readonly finalConfidence: number;
  }): OpportunityExecutionBreakdownDto {
    const fees = this.roundCurrency(
      input.buyPrice * input.buyFeeRate +
        input.realizedSellPrice * input.sellFeeRate,
    );
    const executionPolicy = OPPORTUNITY_SOURCE_EXECUTION_POLICIES[input.sellRow.source];
    const slippagePenalty = this.roundCurrency(
      input.realizedSellPrice *
        Math.min(
          0.08,
          (input.sellRow.bid === undefined
            ? executionPolicy.askExitDiscountRate * 0.22
            : 0.004) +
            input.penalties.sourceDisagreementPenalty * 0.12 +
            (1 - input.finalConfidence) * 0.01,
        ),
    );
    const liquidityPenalty = this.roundCurrency(
      input.realizedSellPrice *
        Math.min(
          0.08,
          input.penalties.liquidityPenalty * 0.24 +
            (input.penalties.categoryPenalty +
              OPPORTUNITY_CATEGORY_POLICIES[input.category].baseCategoryPenalty) *
              0.06,
        ),
    );
    const uncertaintyPenalty = this.roundCurrency(
      input.realizedSellPrice *
        Math.min(
          0.09,
          input.penalties.stalePenalty * 0.22 +
            input.penalties.freshnessPenalty * 0.16 +
            input.antiFakeAssessment.riskScore * 0.04 +
            (1 - input.finalConfidence) * 0.02,
        ),
    );
    const expectedNet = this.roundCurrency(
      input.realizedSellPrice -
        input.buyPrice -
        fees -
        slippagePenalty -
        liquidityPenalty -
        uncertaintyPenalty,
    );

    return {
      realizedSellPrice: this.roundCurrency(input.realizedSellPrice),
      buyPrice: this.roundCurrency(input.buyPrice),
      fees,
      slippagePenalty,
      liquidityPenalty,
      uncertaintyPenalty,
      expectedNet,
    };
  }

  evaluateEligibility(input: {
    readonly category: ItemCategory;
    readonly buyRow: MergedMarketMatrixRowDto;
    readonly sellRow: MergedMarketMatrixRowDto;
    readonly disposition: OpportunityEvaluationDisposition;
    readonly pairabilityStatus: 'pairable' | 'listed_exit_only' | 'blocked';
    readonly componentScores: OpportunityComponentScoresDto;
    readonly finalConfidence: number;
    readonly expectedNetProfit: number;
    readonly rawSpreadPercent: number;
    readonly strictTradable: OpportunityStrictTradableMatchDto;
    readonly preScoreGate: OpportunityPreScoreGateDto;
    readonly backupConfirmed: boolean;
    readonly reasonCodes: readonly OpportunityReasonCode[];
  }): OpportunityEligibilityDto {
    const categoryPolicy = OPPORTUNITY_CATEGORY_POLICIES[input.category];
    const usesSteamSnapshot =
      input.buyRow.source === 'steam-snapshot' ||
      input.sellRow.source === 'steam-snapshot';
    const usesFallbackData =
      input.buyRow.fetchMode === 'fallback' ||
      input.sellRow.fetchMode === 'fallback';
    const listedExitOnly = input.pairabilityStatus === 'listed_exit_only';
    const strictKeyMissing =
      !input.strictTradable.buyKey || !input.strictTradable.sellKey;
    const strictKeyMismatch = !input.strictTradable.matched;
    const blockerReason =
      this.resolveBlockerReason({
        category: input.category,
        expectedNetProfit: input.expectedNetProfit,
        rawSpreadPercent: input.rawSpreadPercent,
        finalConfidence: input.finalConfidence,
        liquidityConfidence: input.componentScores.liquidityConfidence,
        preScoreGate: input.preScoreGate,
        usesSteamSnapshot,
        listedExitOnly,
        usesFallbackData,
        strictKeyMissing,
        strictKeyMismatch,
      });

    if (
      input.disposition === 'rejected' ||
      input.pairabilityStatus === 'blocked' ||
      !input.preScoreGate.passed ||
      strictKeyMismatch
    ) {
      return {
        surfaceTier: 'rejected',
        eligible: false,
        requiresReferenceSupport: false,
        steamSnapshotDemoted: false,
        ...(blockerReason ? { blockerReason } : {}),
      };
    }

    const tradableEligible =
      input.disposition === 'eligible' &&
      input.pairabilityStatus === 'pairable' &&
      !usesSteamSnapshot &&
      !usesFallbackData &&
      !listedExitOnly &&
      input.componentScores.priceConfidence >= 0.56 &&
      input.componentScores.liquidityConfidence >= 0.44 &&
      input.componentScores.freshnessConfidence >= 0.52;

    if (tradableEligible) {
      return {
        surfaceTier: 'tradable',
        eligible: true,
        requiresReferenceSupport: false,
        steamSnapshotDemoted: false,
      };
    }

    const referenceBackedEligible =
      (input.disposition === 'eligible' ||
        input.disposition === 'near_eligible') &&
      input.expectedNetProfit > 0 &&
      input.finalConfidence >= categoryPolicy.minConfidenceCandidate &&
      (input.backupConfirmed || usesSteamSnapshot || listedExitOnly || usesFallbackData);

    if (referenceBackedEligible) {
      return {
        surfaceTier:
          input.disposition === 'near_eligible'
            ? 'near_eligible'
            : 'reference_backed',
        eligible: input.disposition === 'eligible',
        requiresReferenceSupport: true,
        steamSnapshotDemoted: usesSteamSnapshot,
        ...(blockerReason ? { blockerReason } : {}),
      };
    }

    if (input.disposition === 'near_eligible') {
      return {
        surfaceTier: 'near_eligible',
        eligible: false,
        requiresReferenceSupport: false,
        steamSnapshotDemoted: usesSteamSnapshot,
        ...(blockerReason ? { blockerReason } : {}),
      };
    }

    if (
      input.disposition === 'candidate' ||
      input.disposition === 'risky_high_upside'
    ) {
      return {
        surfaceTier: 'research',
        eligible: false,
        requiresReferenceSupport: false,
        steamSnapshotDemoted: usesSteamSnapshot,
        ...(blockerReason ? { blockerReason } : {}),
      };
    }

    return {
      surfaceTier: 'rejected',
      eligible: false,
      requiresReferenceSupport: false,
      steamSnapshotDemoted: false,
      ...(blockerReason ? { blockerReason } : {}),
    };
  }

  buildRiskReasons(input: {
    readonly buyRow: MergedMarketMatrixRowDto;
    readonly sellRow: MergedMarketMatrixRowDto;
    readonly penalties: OpportunityPenaltyBreakdownDto;
    readonly preScoreGate: OpportunityPreScoreGateDto;
    readonly strictTradable: OpportunityStrictTradableMatchDto;
    readonly reasonCodes: readonly OpportunityReasonCode[];
    readonly surfaceTier: OpportunitySurfaceTier;
  }): readonly OpportunityRiskReasonDto[] {
    const reasons = new Map<
      OpportunityRiskReasonCode,
      OpportunityRiskReasonDto
    >();
    const upsert = (
      code: OpportunityRiskReasonCode,
      severity: OpportunityRiskReasonSeverity,
      detail: string,
    ) => {
      const existing = reasons.get(code);

      if (!existing || this.rankRiskReasonSeverity(severity) > this.rankRiskReasonSeverity(existing.severity)) {
        reasons.set(code, {
          code,
          severity,
          detail,
        });
      }
    };
    const reasonCodeSet = new Set(input.reasonCodes);

    if (
      input.buyRow.source === 'steam-snapshot' ||
      input.sellRow.source === 'steam-snapshot'
    ) {
      upsert(
        'steam_snapshot_pair',
        'warning',
        'One leg depends on steam-snapshot pricing.',
      );
    }

    if (input.surfaceTier === 'reference_backed') {
      upsert(
        'reference_backed_only',
        'info',
        'This deal is surfaced with reference support rather than direct tradability.',
      );
    }

    if (input.sellRow.bid === undefined) {
      upsert(
        'listed_exit_only',
        'warning',
        'Exit price depends on a listed ask rather than a firm bid.',
      );
    }

    if (
      input.buyRow.fetchMode === 'fallback' ||
      input.sellRow.fetchMode === 'fallback'
    ) {
      upsert(
        'fallback_data',
        'warning',
        'Fallback data is carrying part of the price signal.',
      );
    }

    if (
      input.preScoreGate.rejectedByStale ||
      reasonCodeSet.has('STALE_SOURCE_STATE')
    ) {
      upsert(
        'stale_sources',
        'critical',
        'At least one source is too stale for confident execution.',
      );
    }

    if (
      input.penalties.liquidityPenalty >= 0.1 ||
      reasonCodeSet.has('INSUFFICIENT_LIQUIDITY') ||
      reasonCodeSet.has('FROZEN_MARKET')
    ) {
      upsert(
        'low_liquidity',
        'warning',
        'Market depth is thin relative to the category target.',
      );
    }

    if (input.penalties.sourceDisagreementPenalty >= 0.08) {
      upsert(
        'cross_source_disagreement',
        'warning',
        'Live sources disagree on the tradable price band.',
      );
    }

    if (!input.strictTradable.buyKey || !input.strictTradable.sellKey) {
      upsert(
        'strict_variant_key_missing',
        'critical',
        'The strict tradable variant key could not be resolved for both legs.',
      );
    } else if (!input.strictTradable.matched) {
      upsert(
        'strict_variant_key_mismatch',
        'critical',
        'The buy and sell legs do not match on the strict tradable variant key.',
      );
    }

    if (
      reasonCodeSet.has('UNKNOWN_FLOAT_PREMIUM') ||
      reasonCodeSet.has('UNKNOWN_PATTERN_PREMIUM') ||
      reasonCodeSet.has('UNKNOWN_PHASE_PREMIUM') ||
      reasonCodeSet.has('UNKNOWN_STICKER_PREMIUM')
    ) {
      upsert(
        'pattern_or_float_uncertainty',
        'warning',
        'Pattern, sticker, or float premiums are not fully aligned across sources.',
      );
    }

    if (
      input.preScoreGate.rejectedByMedian ||
      input.preScoreGate.rejectedByConsensus
    ) {
      upsert(
        'price_outlier',
        'critical',
        'The pair fails the pre-score price sanity checks.',
      );
    }

    if (input.preScoreGate.rejectedByComparableCount) {
      upsert(
        'insufficient_comparables',
        'warning',
        'There are not enough comparable sources to validate the spread.',
      );
    }

    if (
      reasonCodeSet.has('confidence_below_candidate_floor') ||
      reasonCodeSet.has('confidence_below_eligible_floor') ||
      reasonCodeSet.has('LOW_SOURCE_CONFIDENCE')
    ) {
      upsert(
        'low_confidence',
        'warning',
        'The blended confidence sits below the preferred execution floor.',
      );
    }

    return [...reasons.values()].sort((left, right) => {
      const severityDifference =
        this.rankRiskReasonSeverity(right.severity) -
        this.rankRiskReasonSeverity(left.severity);

      if (severityDifference !== 0) {
        return severityDifference;
      }

      return left.code.localeCompare(right.code);
    });
  }

  computeFinalConfidence(input: {
    readonly buyRow: MergedMarketMatrixRowDto;
    readonly sellRow: MergedMarketMatrixRowDto;
    readonly penalties: OpportunityPenaltyBreakdownDto;
  }): number {
    const baseConfidence = this.roundRatio(
      Math.sqrt(
        Math.max(0, input.buyRow.confidence) *
          Math.max(0, input.sellRow.confidence),
      ),
    );

    const penaltyMultiplier = Math.max(
      0.22,
      1 - input.penalties.totalPenalty * 0.82,
    );

    return this.roundRatio(
      baseConfidence * penaltyMultiplier +
        input.penalties.backupConfirmationBoost * 0.6,
    );
  }

  adjustConfidenceForAntiFake(input: {
    readonly baseConfidence: number;
    readonly antiFakeAssessment: AntiFakeAssessment;
  }): number {
    const riskMultiplier = Math.max(
      0.45,
      1 - input.antiFakeAssessment.riskScore * 0.42,
    );
    const premiumMultiplier = Math.max(
      0.58,
      1 - input.antiFakeAssessment.premiumContaminationRisk * 0.28,
    );
    const sanityMultiplier = Math.max(
      0.52,
      1 - input.antiFakeAssessment.marketSanityRisk * 0.24,
    );

    return this.roundRatio(
      input.baseConfidence *
        riskMultiplier *
        premiumMultiplier *
        sanityMultiplier +
        input.antiFakeAssessment.confirmationScore * 0.05,
    );
  }

  classifyOpportunity(input: OpportunityClassificationInput): {
    readonly disposition: OpportunityEvaluationDisposition;
    readonly riskClass: OpportunityEngineRiskClass;
    readonly reasonCodes: readonly OpportunityReasonCode[];
  } {
    const categoryPolicy = OPPORTUNITY_CATEGORY_POLICIES[input.category];
    const mutableReasonCodes = [...input.reasonCodes];
    const exploratoryConfidenceFloor =
      this.resolveCandidateExploratoryConfidenceFloor(categoryPolicy);
    const riskyExploratoryConfidenceFloor =
      this.resolveRiskyHighUpsideConfidenceFloor(categoryPolicy);
    const riskClass = this.computeRiskClass({
      category: input.category,
      expectedNetProfit: input.expectedNetProfit,
      postFeeEdgeStatus: input.postFeeEdgeStatus,
      finalConfidence: input.finalConfidence,
      antiFakeAssessment: input.antiFakeAssessment,
      penalties: input.penalties,
    });

    if (input.antiFakeAssessment.hardReject) {
      return {
        disposition: 'rejected',
        riskClass,
        reasonCodes: this.uniqueReasonCodes(mutableReasonCodes),
      };
    }

    if (input.postFeeEdgeStatus === 'non_positive') {
      mutableReasonCodes.push(
        'negative_fees_adjusted_spread',
        'true_non_positive_edge',
      );

      return {
        disposition: 'rejected',
        riskClass,
        reasonCodes: this.uniqueReasonCodes(mutableReasonCodes),
      };
    }

    if (input.postFeeEdgeStatus === 'near_equal') {
      mutableReasonCodes.push('near_equal_after_fees');
    }

    if (input.finalConfidence < exploratoryConfidenceFloor) {
      mutableReasonCodes.push('confidence_below_candidate_floor');

      if (
        input.expectedNetProfit >= categoryPolicy.highUpsideNet &&
        input.finalConfidence >= riskyExploratoryConfidenceFloor
      ) {
        mutableReasonCodes.push('high_upside_with_elevated_risk');

        return {
          disposition: 'risky_high_upside',
          riskClass,
          reasonCodes: this.uniqueReasonCodes(mutableReasonCodes),
        };
      }

      return {
        disposition: 'rejected',
        riskClass,
        reasonCodes: this.uniqueReasonCodes(mutableReasonCodes),
      };
    }

    if (input.finalConfidence < categoryPolicy.minConfidenceCandidate) {
      mutableReasonCodes.push('confidence_below_candidate_floor');
    }

    const severeAntiFakeRisk =
      input.antiFakeAssessment.riskScore >= 0.56 ||
      input.antiFakeAssessment.premiumContaminationRisk >= 0.48 ||
      input.antiFakeAssessment.marketSanityRisk >= 0.58;

    if (
      input.expectedNetProfit >= categoryPolicy.highUpsideNet &&
      input.finalConfidence >= Math.max(0.28, exploratoryConfidenceFloor) &&
      (riskClass === 'high' || riskClass === 'extreme' || severeAntiFakeRisk)
    ) {
      mutableReasonCodes.push('high_upside_with_elevated_risk');

      return {
        disposition: 'risky_high_upside',
        riskClass,
        reasonCodes: this.uniqueReasonCodes(mutableReasonCodes),
      };
    }

    if (
      input.expectedNetProfit >= categoryPolicy.minExpectedNet &&
      input.rawSpreadPercent >= categoryPolicy.minSpreadPercent &&
      input.finalConfidence >= categoryPolicy.minConfidenceEligible &&
      riskClass !== 'extreme' &&
      !severeAntiFakeRisk
    ) {
      mutableReasonCodes.push('meets_eligible_thresholds');

      return {
        disposition: 'eligible',
        riskClass,
        reasonCodes: this.uniqueReasonCodes(mutableReasonCodes),
      };
    }

    if (
      input.expectedNetProfit >= categoryPolicy.nearEligibleExpectedNet &&
      input.rawSpreadPercent >= categoryPolicy.nearEligibleSpreadPercent &&
      input.finalConfidence >= categoryPolicy.minConfidenceCandidate &&
      !severeAntiFakeRisk
    ) {
      if (input.expectedNetProfit < categoryPolicy.minExpectedNet) {
        mutableReasonCodes.push('expected_net_below_category_floor');
      }

      if (input.rawSpreadPercent < categoryPolicy.minSpreadPercent) {
        mutableReasonCodes.push('spread_percent_below_category_floor');
      }

      if (input.finalConfidence < categoryPolicy.minConfidenceEligible) {
        mutableReasonCodes.push('confidence_below_eligible_floor');
      }

      mutableReasonCodes.push('meets_near_eligible_thresholds');

      return {
        disposition: 'near_eligible',
        riskClass,
        reasonCodes: this.uniqueReasonCodes(mutableReasonCodes),
      };
    }

    if (input.expectedNetProfit < categoryPolicy.nearEligibleExpectedNet) {
      mutableReasonCodes.push('expected_net_below_category_floor');
    }

    if (input.rawSpreadPercent < categoryPolicy.nearEligibleSpreadPercent) {
      mutableReasonCodes.push('spread_percent_below_category_floor');
    }

    mutableReasonCodes.push('meets_candidate_thresholds');

    return {
      disposition: 'candidate',
      riskClass,
      reasonCodes: this.uniqueReasonCodes(mutableReasonCodes),
    };
  }

  private computeFreshnessPenalty(
    buyRow: MergedMarketMatrixRowDto,
    sellRow: MergedMarketMatrixRowDto,
  ): number {
    const buyPenalty = this.computeLagRatioPenalty(buyRow);
    const sellPenalty = this.computeLagRatioPenalty(sellRow);

    return (buyPenalty + sellPenalty) / 2;
  }

  private computeLiquidityPenalty(
    category: ItemCategory,
    buyRow: MergedMarketMatrixRowDto,
    sellRow: MergedMarketMatrixRowDto,
    expectedExitPrice: number,
  ): number {
    const targetDepth =
      OPPORTUNITY_CATEGORY_POLICIES[category].liquidityTargetDepth;
    const buyDepthRatio = Math.max(
      0,
      Math.min(1, (buyRow.listedQty ?? 0) / Math.max(1, targetDepth)),
    );
    const sellDepthRatio = Math.max(
      0,
      Math.min(1, (sellRow.listedQty ?? 0) / Math.max(1, targetDepth)),
    );
    const depthPenalty =
      (1 - Math.max(0.2, buyDepthRatio)) * 0.09 +
      (1 - Math.max(0.15, sellDepthRatio)) * 0.09;
    const noBidPenalty = sellRow.bid === undefined ? 0.055 : 0;
    const thinProfitBufferPenalty =
      expectedExitPrice <= (buyRow.ask ?? 0) * 1.01 ? 0.04 : 0;

    return Math.min(
      0.28,
      depthPenalty + noBidPenalty + thinProfitBufferPenalty,
    );
  }

  private computeStalePenalty(
    buyRow: MergedMarketMatrixRowDto,
    sellRow: MergedMarketMatrixRowDto,
  ): number {
    return (
      this.computeSingleRowStalePenalty(buyRow) +
      this.computeSingleRowStalePenalty(sellRow)
    );
  }

  private computeSourceDisagreementPenalty(
    matrix: MergedMarketMatrixDto,
    buyRow: MergedMarketMatrixRowDto,
    sellRow: MergedMarketMatrixRowDto,
  ): number {
    const matrixPenalty =
      matrix.conflict.state === 'aligned'
        ? 0
        : matrix.conflict.state === 'divergent'
          ? 0.05
          : matrix.conflict.state === 'conflicted'
            ? 0.11
            : 0.03;
    const pairDeviationPenalty =
      ((buyRow.deviationFromConsensusPercent ?? 0) +
        (sellRow.deviationFromConsensusPercent ?? 0)) /
      100 /
      2;

    return Math.min(0.18, matrixPenalty + pairDeviationPenalty);
  }

  private computeRiskClass(input: {
    readonly category: ItemCategory;
    readonly expectedNetProfit: number;
    readonly postFeeEdgeStatus: 'positive' | 'near_equal' | 'non_positive';
    readonly finalConfidence: number;
    readonly antiFakeAssessment: AntiFakeAssessment;
    readonly penalties: OpportunityPenaltyBreakdownDto;
  }): OpportunityEngineRiskClass {
    if (
      input.finalConfidence < 0.2 ||
      input.penalties.totalPenalty >= 0.45 ||
      input.antiFakeAssessment.riskScore >= 0.72 ||
      input.postFeeEdgeStatus === 'non_positive'
    ) {
      return 'extreme';
    }

    if (
      input.finalConfidence < 0.45 ||
      input.penalties.stalePenalty >= 0.12 ||
      input.penalties.liquidityPenalty >= 0.16 ||
      input.antiFakeAssessment.riskScore >= 0.42 ||
      input.antiFakeAssessment.marketSanityRisk >= 0.42
    ) {
      return 'high';
    }

    if (
      input.finalConfidence < 0.72 ||
      OPPORTUNITY_CATEGORY_POLICIES[input.category].baseCategoryPenalty >=
        0.06 ||
      input.penalties.sourceDisagreementPenalty >= 0.08 ||
      input.antiFakeAssessment.premiumContaminationRisk >= 0.22
    ) {
      return 'medium';
    }

    return 'low';
  }

  private resolveCandidateExploratoryConfidenceFloor(categoryPolicy: {
    readonly minConfidenceCandidate: number;
  }): number {
    return this.roundRatio(
      Math.max(0.18, categoryPolicy.minConfidenceCandidate * 0.45),
    );
  }

  private resolveRiskyHighUpsideConfidenceFloor(categoryPolicy: {
    readonly minConfidenceCandidate: number;
  }): number {
    return this.roundRatio(
      Math.max(0.1, categoryPolicy.minConfidenceCandidate * 0.28),
    );
  }

  private computeLagRatioPenalty(row: MergedMarketMatrixRowDto): number {
    const lagRatio = Math.max(
      0,
      row.freshness.lagMs / Math.max(1, row.freshness.maxStaleMs),
    );

    return Math.min(0.12, lagRatio * 0.08);
  }

  private computeSingleRowStalePenalty(row: MergedMarketMatrixRowDto): number {
    const fallbackPenalty =
      row.fetchMode === 'fallback'
        ? row.source === 'steam-snapshot'
          ? 0.08
          : 0.05
        : 0;
    const staleFreshnessPenalty = row.freshness.state === 'stale' ? 0.035 : 0;

    return Math.min(0.14, fallbackPenalty + staleFreshnessPenalty);
  }

  private resolveBlockerReason(input: {
    readonly category: ItemCategory;
    readonly expectedNetProfit: number;
    readonly rawSpreadPercent: number;
    readonly finalConfidence: number;
    readonly liquidityConfidence: number;
    readonly preScoreGate: OpportunityPreScoreGateDto;
    readonly usesSteamSnapshot: boolean;
    readonly listedExitOnly: boolean;
    readonly usesFallbackData: boolean;
    readonly strictKeyMissing: boolean;
    readonly strictKeyMismatch: boolean;
  }): OpportunityBlockerReason | undefined {
    const categoryPolicy = OPPORTUNITY_CATEGORY_POLICIES[input.category];

    if (input.strictKeyMismatch) {
      return 'strict_variant_key_mismatch';
    }

    if (input.strictKeyMissing) {
      return 'strict_variant_key_missing';
    }

    if (input.preScoreGate.rejectedByStale) {
      return 'stale_sources';
    }

    if (
      input.preScoreGate.rejectedByMedian ||
      input.preScoreGate.rejectedByConsensus
    ) {
      return 'pre_score_outlier';
    }

    if (input.preScoreGate.rejectedByComparableCount) {
      return 'insufficient_comparables';
    }

    if (input.usesSteamSnapshot) {
      return 'steam_snapshot_pair';
    }

    if (input.listedExitOnly) {
      return 'listed_exit_only';
    }

    if (input.usesFallbackData) {
      return 'fallback_data';
    }

    if (input.expectedNetProfit < categoryPolicy.minExpectedNet) {
      return 'low_expected_net';
    }

    if (input.rawSpreadPercent < categoryPolicy.minSpreadPercent) {
      return 'low_spread_percent';
    }

    if (input.finalConfidence < categoryPolicy.minConfidenceEligible) {
      return 'low_confidence';
    }

    if (input.liquidityConfidence < 0.44) {
      return 'low_liquidity';
    }

    return undefined;
  }

  private uniqueReasonCodes(
    reasonCodes: readonly OpportunityReasonCode[],
  ): readonly OpportunityReasonCode[] {
    return [...new Set(reasonCodes)];
  }

  private roundCurrency(value: number): number {
    return Number(value.toFixed(4));
  }

  private roundRatio(value: number): number {
    return Number(Math.max(0, Math.min(1, value)).toFixed(4));
  }

  private rankRiskReasonSeverity(
    severity: OpportunityRiskReasonSeverity,
  ): number {
    switch (severity) {
      case 'info':
        return 0;
      case 'warning':
        return 1;
      case 'critical':
        return 2;
    }
  }
}
