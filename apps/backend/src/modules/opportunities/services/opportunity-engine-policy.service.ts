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
  OpportunityReasonCode,
} from '../domain/opportunity-engine.model';
import type { OpportunityPenaltyBreakdownDto } from '../dto/opportunity-engine.dto';

interface OpportunityClassificationInput {
  readonly category: ItemCategory;
  readonly expectedNetProfit: number;
  readonly rawSpreadPercent: number;
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

    return this.roundRatio(
      baseConfidence -
        input.penalties.totalPenalty +
        input.penalties.backupConfirmationBoost,
    );
  }

  adjustConfidenceForAntiFake(input: {
    readonly baseConfidence: number;
    readonly antiFakeAssessment: AntiFakeAssessment;
  }): number {
    return this.roundRatio(
      input.baseConfidence -
        input.antiFakeAssessment.riskScore * 0.16 -
        input.antiFakeAssessment.premiumContaminationRisk * 0.12 -
        input.antiFakeAssessment.marketSanityRisk * 0.1 +
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
    const riskClass = this.computeRiskClass({
      category: input.category,
      expectedNetProfit: input.expectedNetProfit,
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

    if (input.expectedNetProfit <= 0) {
      mutableReasonCodes.push('negative_fees_adjusted_spread');

      return {
        disposition: 'rejected',
        riskClass,
        reasonCodes: this.uniqueReasonCodes(mutableReasonCodes),
      };
    }

    if (input.finalConfidence < exploratoryConfidenceFloor) {
      mutableReasonCodes.push('confidence_below_candidate_floor');

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

    if (input.expectedNetProfit > 0 && input.rawSpreadPercent > 0) {
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

    return {
      disposition: 'rejected',
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
    readonly finalConfidence: number;
    readonly antiFakeAssessment: AntiFakeAssessment;
    readonly penalties: OpportunityPenaltyBreakdownDto;
  }): OpportunityEngineRiskClass {
    if (
      input.finalConfidence < 0.2 ||
      input.penalties.totalPenalty >= 0.45 ||
      input.antiFakeAssessment.riskScore >= 0.72 ||
      input.expectedNetProfit <= 0
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
}
