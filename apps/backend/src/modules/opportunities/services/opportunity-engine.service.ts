import { Inject, Injectable } from '@nestjs/common';

import type {
  MergedMarketMatrixDto,
  MergedMarketMatrixRowDto,
} from '../../market-state/dto/merged-market-matrix.dto';
import { MarketStateMergeService } from '../../market-state/services/market-state-merge.service';
import type { CompiledScheme } from '../../schemes/domain/scheme.model';
import type { AntiFakeAssessment } from '../domain/anti-fake.model';
import type {
  EvaluateOpportunityMatrixInput,
  EvaluateOpportunityVariantInput,
  EvaluateOpportunityVariantsInput,
  OpportunityEngineScanResultDto,
  OpportunityEngineVariantResultDto,
  OpportunityEvaluationDto,
  OpportunityPairabilityDto,
  OpportunityPenaltyBreakdownDto,
  OpportunityRankingInputsDto,
  OpportunitySourceLegDto,
  OpportunityValidationDto,
} from '../domain/opportunity-engine.contract';
import {
  OPPORTUNITY_EVALUATION_DISPOSITIONS,
  type OpportunityEvaluationDisposition,
  type OpportunityEngineRiskClass,
  type OpportunityReasonCode,
} from '../domain/opportunity-engine.model';
import { OPPORTUNITY_CATEGORY_POLICIES } from '../domain/opportunity-engine-policy.model';
import { buildOpportunityKey } from '../domain/opportunity-key';
import { OpportunityAntiFakeService } from './opportunity-anti-fake.service';
import { OpportunityEnginePolicyService } from './opportunity-engine-policy.service';

const DEFAULT_ENGINE_MAX_PAIRS = 12;

@Injectable()
export class OpportunityEngineService {
  constructor(
    @Inject(MarketStateMergeService)
    private readonly marketStateMergeService: MarketStateMergeService,
    @Inject(OpportunityEnginePolicyService)
    private readonly opportunityEnginePolicyService: OpportunityEnginePolicyService,
    @Inject(OpportunityAntiFakeService)
    private readonly opportunityAntiFakeService: OpportunityAntiFakeService,
  ) {}

  async evaluateVariant(
    itemVariantId: string,
    input: EvaluateOpportunityVariantInput = {},
  ): Promise<OpportunityEngineVariantResultDto> {
    const matrix =
      await this.marketStateMergeService.getVariantMatrix(itemVariantId);

    return this.evaluateMatrix({
      matrix,
      includeRejected: input.includeRejected ?? false,
      maxPairs: input.maxPairs ?? DEFAULT_ENGINE_MAX_PAIRS,
      ...(input.scheme ? { scheme: input.scheme } : {}),
    });
  }

  async evaluateVariants(
    input: EvaluateOpportunityVariantsInput,
  ): Promise<OpportunityEngineScanResultDto> {
    const generatedAt = new Date();
    const itemVariantIds = [...new Set(input.itemVariantIds)];
    const results = await Promise.all(
      itemVariantIds.map((itemVariantId) =>
        this.evaluateVariant(itemVariantId, {
          ...(input.includeRejected !== undefined
            ? { includeRejected: input.includeRejected }
            : {}),
          ...(input.maxPairs !== undefined ? { maxPairs: input.maxPairs } : {}),
          ...(input.scheme ? { scheme: input.scheme } : {}),
        }),
      ),
    );
    const dispositionSummary = this.createDispositionSummary();

    for (const result of results) {
      for (const disposition of OPPORTUNITY_EVALUATION_DISPOSITIONS) {
        dispositionSummary[disposition] +=
          result.dispositionSummary[disposition];
      }
    }

    return {
      generatedAt,
      evaluatedItemCount: results.length,
      evaluatedPairCount: results.reduce(
        (total, result) => total + result.evaluatedPairCount,
        0,
      ),
      dispositionSummary,
      antiFakeCounters: this.opportunityAntiFakeService.createCounters(
        results.flatMap((result) => result.evaluations),
      ),
      results,
    };
  }

  private evaluateMatrix(
    input: EvaluateOpportunityMatrixInput,
  ): OpportunityEngineVariantResultDto {
    if (input.scheme && !this.isVariantInSchemeScope(input.matrix, input.scheme)) {
      return {
        generatedAt: input.matrix.generatedAt,
        category: input.matrix.category,
        canonicalItemId: input.matrix.canonicalItemId,
        canonicalDisplayName: input.matrix.canonicalDisplayName,
        itemVariantId: input.matrix.itemVariantId,
        variantDisplayName: input.matrix.variantDisplayName,
        evaluatedPairCount: 0,
        returnedPairCount: 0,
        dispositionSummary: this.createDispositionSummary(),
        antiFakeCounters: this.opportunityAntiFakeService.createCounters([]),
        evaluations: [],
      };
    }

    const tradableRows = input.matrix.rows.filter(
      (row) => row.fetchMode !== 'backup',
    );
    const backupRows = input.matrix.rows.filter(
      (row) => row.fetchMode === 'backup',
    );
    const allEvaluations: OpportunityEvaluationDto[] = [];

    for (const buyRow of tradableRows) {
      for (const sellRow of tradableRows) {
        if (buyRow.source === sellRow.source) {
          continue;
        }

        allEvaluations.push(
          this.evaluatePair({
            matrix: input.matrix,
            buyRow,
            sellRow,
            backupRows,
            ...(input.scheme ? { scheme: input.scheme } : {}),
          }),
        );
      }
    }

    const sortedEvaluations = allEvaluations
      .filter((evaluation) =>
        input.includeRejected ? true : evaluation.disposition !== 'rejected',
      )
      .sort((left, right) => this.compareEvaluations(left, right))
      .slice(0, input.maxPairs);
    const dispositionSummary = this.createDispositionSummary();

    for (const evaluation of allEvaluations) {
      dispositionSummary[evaluation.disposition] += 1;
    }

    return {
      generatedAt: input.matrix.generatedAt,
      category: input.matrix.category,
      canonicalItemId: input.matrix.canonicalItemId,
      canonicalDisplayName: input.matrix.canonicalDisplayName,
      itemVariantId: input.matrix.itemVariantId,
      variantDisplayName: input.matrix.variantDisplayName,
      evaluatedPairCount:
        tradableRows.length * Math.max(0, tradableRows.length - 1),
      returnedPairCount: sortedEvaluations.length,
      dispositionSummary,
      antiFakeCounters:
        this.opportunityAntiFakeService.createCounters(allEvaluations),
      evaluations: sortedEvaluations,
    };
  }

  private evaluatePair(input: {
    readonly matrix: MergedMarketMatrixDto;
    readonly buyRow: MergedMarketMatrixRowDto;
    readonly sellRow: MergedMarketMatrixRowDto;
    readonly backupRows: readonly MergedMarketMatrixRowDto[];
    readonly scheme?: CompiledScheme;
  }): OpportunityEvaluationDto {
    const baseReasonCodes: OpportunityReasonCode[] = [];
    const usesFallbackData =
      input.buyRow.fetchMode === 'fallback' ||
      input.sellRow.fetchMode === 'fallback';
    const listedExitOnly = input.sellRow.bid === undefined;

    if (input.buyRow.ask === undefined) {
      return this.buildRejectedEvaluation({
        ...input,
        buyCost: 0,
        sellSignalPrice: input.sellRow.bid ?? input.sellRow.ask ?? 0,
        antiFakeAssessment: this.createEmptyAntiFakeAssessment(),
        reasonCodes: ['buy_source_has_no_ask'],
      });
    }

    const sellSignalPrice = input.sellRow.bid ?? input.sellRow.ask;

    if (sellSignalPrice === undefined) {
      return this.buildRejectedEvaluation({
        ...input,
        buyCost: input.buyRow.ask,
        sellSignalPrice: 0,
        antiFakeAssessment: this.createEmptyAntiFakeAssessment(),
        reasonCodes: ['sell_source_has_no_exit_signal'],
      });
    }

    if (listedExitOnly) {
      baseReasonCodes.push('sell_source_requires_listed_exit');
    }

    if (usesFallbackData) {
      baseReasonCodes.push(
        input.buyRow.source === 'steam-snapshot' ||
          input.sellRow.source === 'steam-snapshot'
          ? 'steam_snapshot_fallback_used'
          : 'stale_snapshot_used',
      );
    }

    const expectedExitPrice =
      this.opportunityEnginePolicyService.getExpectedExitPrice(
        input.matrix.category,
        input.sellRow,
      );

    if (expectedExitPrice === null) {
      return this.buildRejectedEvaluation({
        ...input,
        buyCost: input.buyRow.ask,
        sellSignalPrice,
        antiFakeAssessment: this.createEmptyAntiFakeAssessment(),
        reasonCodes: [...baseReasonCodes, 'sell_source_has_no_exit_signal'],
      });
    }

    const buyCost = input.buyRow.ask;
    const rawSpread = this.roundCurrency(sellSignalPrice - buyCost);
    const rawSpreadPercent = this.toPercent(
      rawSpread / Math.max(0.0001, buyCost),
    );

    if (rawSpread <= 0) {
      baseReasonCodes.push('non_positive_raw_spread');
    }

    const buyFeeRate = this.opportunityEnginePolicyService.getBuyFeeRate(
      input.buyRow.source,
    );
    const sellFeeRate = this.opportunityEnginePolicyService.getSellFeeRate(
      input.sellRow.source,
    );
    const feesAdjustedSpread = this.roundCurrency(
      expectedExitPrice * (1 - sellFeeRate) - buyCost * (1 + buyFeeRate),
    );
    const backupConfirmation = this.resolveBackupConfirmation(
      input.backupRows,
      buyCost,
      sellSignalPrice,
    );
    const antiFakeAssessment = this.opportunityAntiFakeService.assess({
      matrix: input.matrix,
      buyRow: input.buyRow,
      sellRow: input.sellRow,
      backupRows: input.backupRows,
      buyCost,
      sellSignalPrice,
    });

    if (antiFakeAssessment.hardReject) {
      return this.buildRejectedEvaluation({
        ...input,
        buyCost,
        sellSignalPrice,
        antiFakeAssessment,
        reasonCodes: [
          ...baseReasonCodes,
          ...antiFakeAssessment.reasonCodes,
        ] satisfies OpportunityReasonCode[],
      });
    }

    const penalties = this.opportunityEnginePolicyService.buildPenalties({
      category: input.matrix.category,
      matrix: input.matrix,
      buyRow: input.buyRow,
      sellRow: input.sellRow,
      expectedExitPrice,
      backupConfirmationBoost: backupConfirmation?.boost ?? 0,
    });

    if (penalties.freshnessPenalty >= 0.08) {
      baseReasonCodes.push('freshness_penalty_elevated');
    }

    if (penalties.liquidityPenalty >= 0.12) {
      baseReasonCodes.push('liquidity_penalty_elevated');
    }

    if (penalties.stalePenalty >= 0.08) {
      baseReasonCodes.push('stale_penalty_elevated');
    }

    if (penalties.categoryPenalty >= 0.07) {
      baseReasonCodes.push('category_penalty_elevated');
    }

    if (penalties.sourceDisagreementPenalty >= 0.08) {
      baseReasonCodes.push('source_disagreement_penalty_elevated');
    }

    if (backupConfirmation?.supported) {
      baseReasonCodes.push('backup_reference_confirms_band');
    } else if (input.backupRows.length > 0) {
      baseReasonCodes.push('backup_reference_outlier');
    }

    const finalConfidence =
      this.opportunityEnginePolicyService.adjustConfidenceForAntiFake({
        baseConfidence:
          this.opportunityEnginePolicyService.computeFinalConfidence({
            buyRow: input.buyRow,
            sellRow: input.sellRow,
            penalties,
          }),
        antiFakeAssessment,
      });
    const classification =
      this.opportunityEnginePolicyService.classifyOpportunity({
        category: input.matrix.category,
        expectedNetProfit: feesAdjustedSpread,
        rawSpreadPercent,
        finalConfidence,
        antiFakeAssessment,
        penalties,
        reasonCodes: [
          ...baseReasonCodes,
          ...antiFakeAssessment.reasonCodes,
        ] satisfies OpportunityReasonCode[],
      });
    const pairability = this.buildPairability({
      buyRow: input.buyRow,
      sellRow: input.sellRow,
      reasonCodes: classification.reasonCodes,
      schemeBlocked: false,
    });
    const evaluation = this.buildEvaluation({
      matrix: input.matrix,
      buyRow: input.buyRow,
      sellRow: input.sellRow,
      buyCost,
      sellSignalPrice,
      expectedExitPrice,
      sellFeeRate,
      rawSpread,
      rawSpreadPercent,
      feesAdjustedSpread,
      finalConfidence,
      penalties,
      antiFakeAssessment,
      disposition: classification.disposition,
      riskClass: classification.riskClass,
      reasonCodes: classification.reasonCodes,
      pairability,
      ...(backupConfirmation?.supported
        ? {
            backupConfirmation: {
              source: backupConfirmation.row.source,
              sourceName: backupConfirmation.row.sourceName,
              referencePrice: backupConfirmation.referencePrice,
            },
          }
        : {}),
    });

    return input.scheme
      ? this.applySchemeEvaluation(evaluation, input.matrix, input.scheme)
      : evaluation;
  }

  private buildEvaluation(input: {
    readonly matrix: MergedMarketMatrixDto;
    readonly buyRow: MergedMarketMatrixRowDto;
    readonly sellRow: MergedMarketMatrixRowDto;
    readonly buyCost: number;
    readonly sellSignalPrice: number;
    readonly expectedExitPrice: number;
    readonly sellFeeRate: number;
    readonly rawSpread: number;
    readonly rawSpreadPercent: number;
    readonly feesAdjustedSpread: number;
    readonly finalConfidence: number;
    readonly penalties: OpportunityPenaltyBreakdownDto;
    readonly antiFakeAssessment: AntiFakeAssessment;
    readonly disposition: OpportunityEvaluationDisposition;
    readonly riskClass: OpportunityEngineRiskClass;
    readonly reasonCodes: readonly OpportunityReasonCode[];
    readonly pairability: OpportunityPairabilityDto;
    readonly backupConfirmation?: {
      readonly source: OpportunitySourceLegDto['source'];
      readonly sourceName: string;
      readonly referencePrice: number;
    };
  }): OpportunityEvaluationDto {
    const reasonCodes = this.uniqueReasonCodes(input.reasonCodes);
    const validation = this.buildValidation({
      disposition: input.disposition,
      antiFakeAssessment: input.antiFakeAssessment,
      reasonCodes,
      pairability: input.pairability,
    });
    const rankingInputs = this.buildRankingInputs({
      category: input.matrix.category,
      buyRow: input.buyRow,
      sellRow: input.sellRow,
      expectedNetProfit: input.feesAdjustedSpread,
      rawSpreadPercent: input.rawSpreadPercent,
      finalConfidence: input.finalConfidence,
      penalties: input.penalties,
      antiFakeAssessment: input.antiFakeAssessment,
      pairability: input.pairability,
      disposition: input.disposition,
    });

    return {
      opportunityKey: buildOpportunityKey({
        itemVariantId: input.matrix.itemVariantId,
        buySource: input.buyRow.source,
        sellSource: input.sellRow.source,
      }),
      disposition: input.disposition,
      reasonCodes,
      riskClass: input.riskClass,
      category: input.matrix.category,
      canonicalItemId: input.matrix.canonicalItemId,
      canonicalDisplayName: input.matrix.canonicalDisplayName,
      itemVariantId: input.matrix.itemVariantId,
      variantDisplayName: input.matrix.variantDisplayName,
      sourcePairKey: `${input.buyRow.source}->${input.sellRow.source}`,
      buy: this.toSourceLeg(input.buyRow),
      sell: this.toSourceLeg(input.sellRow),
      rawSpread: input.rawSpread,
      rawSpreadPercent: input.rawSpreadPercent,
      feesAdjustedSpread: input.feesAdjustedSpread,
      expectedNetProfit: input.feesAdjustedSpread,
      expectedExitPrice: input.expectedExitPrice,
      estimatedSellFeeRate: input.sellFeeRate,
      buyCost: input.buyCost,
      sellSignalPrice: input.sellSignalPrice,
      finalConfidence: input.finalConfidence,
      penalties: input.penalties,
      antiFakeAssessment: input.antiFakeAssessment,
      validation,
      pairability: input.pairability,
      explainability: {
        reasonCodes,
        penalties: input.penalties,
      },
      rankingInputs,
      ...(input.backupConfirmation
        ? { backupConfirmation: input.backupConfirmation }
        : {}),
    };
  }

  private buildRejectedEvaluation(input: {
    readonly matrix: MergedMarketMatrixDto;
    readonly buyRow: MergedMarketMatrixRowDto;
    readonly sellRow: MergedMarketMatrixRowDto;
    readonly buyCost: number;
    readonly sellSignalPrice: number;
    readonly antiFakeAssessment: AntiFakeAssessment;
    readonly reasonCodes: readonly OpportunityReasonCode[];
    readonly scheme?: CompiledScheme;
  }): OpportunityEvaluationDto {
    return this.buildEvaluation({
      matrix: input.matrix,
      buyRow: input.buyRow,
      sellRow: input.sellRow,
      buyCost: input.buyCost,
      sellSignalPrice: input.sellSignalPrice,
      expectedExitPrice: 0,
      sellFeeRate: 0,
      rawSpread: 0,
      rawSpreadPercent: 0,
      feesAdjustedSpread: 0,
      finalConfidence: 0,
      penalties: {
        freshnessPenalty: 0,
        liquidityPenalty: 0,
        stalePenalty: 0,
        categoryPenalty: 0,
        sourceDisagreementPenalty: 0,
        backupConfirmationBoost: 0,
        totalPenalty: 0,
      },
      antiFakeAssessment: input.antiFakeAssessment,
      disposition: 'rejected',
      riskClass: 'extreme',
      reasonCodes: input.reasonCodes,
      pairability: this.buildPairability({
        buyRow: input.buyRow,
        sellRow: input.sellRow,
        reasonCodes: input.reasonCodes,
        schemeBlocked: input.reasonCodes.some((reasonCode) =>
          reasonCode.startsWith('scheme_'),
        ),
      }),
    });
  }

  private applySchemeEvaluation(
    evaluation: OpportunityEvaluationDto,
    matrix: MergedMarketMatrixDto,
    scheme: CompiledScheme,
  ): OpportunityEvaluationDto {
    const schemeReasonCodes: OpportunityReasonCode[] = [];
    let schemeBlocked = false;

    if (
      scheme.selection.buySources.length > 0 &&
      !scheme.selection.buySources.includes(evaluation.buy.source)
    ) {
      schemeReasonCodes.push('scheme_buy_source_not_allowed');
      schemeBlocked = true;
    }

    if (
      scheme.selection.sellSources.length > 0 &&
      !scheme.selection.sellSources.includes(evaluation.sell.source)
    ) {
      schemeReasonCodes.push('scheme_sell_source_not_allowed');
      schemeBlocked = true;
    }

    if (
      scheme.selection.excludedSourcePairs.includes(evaluation.sourcePairKey)
    ) {
      schemeReasonCodes.push('scheme_source_pair_excluded');
      schemeBlocked = true;
    }

    if (
      evaluation.expectedNetProfit < scheme.thresholds.minExpectedNetProfit
    ) {
      schemeReasonCodes.push('scheme_profit_below_floor');
      schemeBlocked = true;
    }

    if (evaluation.finalConfidence < scheme.thresholds.minConfidence) {
      schemeReasonCodes.push('scheme_confidence_below_floor');
      schemeBlocked = true;
    }

    if (
      evaluation.rankingInputs.liquidityScore < scheme.thresholds.minLiquidity
    ) {
      schemeReasonCodes.push('scheme_liquidity_below_floor');
      schemeBlocked = true;
    }

    if (
      scheme.thresholds.minBuyCost !== undefined &&
      evaluation.buyCost < scheme.thresholds.minBuyCost
    ) {
      schemeReasonCodes.push('scheme_buy_cost_out_of_range');
      schemeBlocked = true;
    }

    if (
      scheme.thresholds.maxBuyCost !== undefined &&
      evaluation.buyCost > scheme.thresholds.maxBuyCost
    ) {
      schemeReasonCodes.push('scheme_buy_cost_out_of_range');
      schemeBlocked = true;
    }

    if (
      this.rankDisposition(evaluation.disposition) >
      this.rankDisposition(scheme.thresholds.minDisposition)
    ) {
      schemeReasonCodes.push('scheme_disposition_below_floor');
      schemeBlocked = true;
    }

    if (
      scheme.thresholds.maxRiskClass &&
      this.rankRiskClass(evaluation.riskClass) >
        this.rankRiskClass(scheme.thresholds.maxRiskClass)
    ) {
      schemeReasonCodes.push('scheme_risk_above_ceiling');
      schemeBlocked = true;
    }

    if (
      !scheme.validation.allowRiskyHighUpside &&
      evaluation.disposition === 'risky_high_upside'
    ) {
      schemeReasonCodes.push('scheme_risky_high_upside_blocked');
      schemeBlocked = true;
    }

    if (
      !scheme.validation.allowFallbackData &&
      evaluation.pairability.usesFallbackData
    ) {
      schemeReasonCodes.push('scheme_fallback_blocked');
      schemeBlocked = true;
    }

    if (
      !scheme.validation.allowListedExitOnly &&
      evaluation.pairability.listedExitOnly
    ) {
      schemeReasonCodes.push('scheme_listed_exit_blocked');
      schemeBlocked = true;
    }

    if (!schemeBlocked) {
      return evaluation;
    }

    const buyRow = matrix.rows.find(
      (row) => row.source === evaluation.buy.source,
    );
    const sellRow = matrix.rows.find(
      (row) => row.source === evaluation.sell.source,
    );

    if (!buyRow || !sellRow) {
      return evaluation;
    }
    const pairability = this.buildPairability({
      buyRow,
      sellRow,
      reasonCodes: [...evaluation.reasonCodes, ...schemeReasonCodes],
      schemeBlocked: true,
    });

    return this.buildEvaluation({
      matrix,
      buyRow,
      sellRow,
      buyCost: evaluation.buyCost,
      sellSignalPrice: evaluation.sellSignalPrice,
      expectedExitPrice: evaluation.expectedExitPrice,
      sellFeeRate: evaluation.estimatedSellFeeRate,
      rawSpread: evaluation.rawSpread,
      rawSpreadPercent: evaluation.rawSpreadPercent,
      feesAdjustedSpread: evaluation.feesAdjustedSpread,
      finalConfidence: evaluation.finalConfidence,
      penalties: evaluation.penalties,
      antiFakeAssessment: evaluation.antiFakeAssessment,
      disposition: 'rejected',
      riskClass: evaluation.riskClass,
      reasonCodes: [...evaluation.reasonCodes, ...schemeReasonCodes],
      pairability,
      ...(evaluation.backupConfirmation
        ? { backupConfirmation: evaluation.backupConfirmation }
        : {}),
    });
  }

  private buildValidation(input: {
    readonly disposition: OpportunityEvaluationDisposition;
    readonly antiFakeAssessment: AntiFakeAssessment;
    readonly reasonCodes: readonly OpportunityReasonCode[];
    readonly pairability: OpportunityPairabilityDto;
  }): OpportunityValidationDto {
    if (input.disposition === 'rejected') {
      return {
        status: 'rejected',
        hardReject: input.antiFakeAssessment.hardReject,
        matchConfidence: input.antiFakeAssessment.matchConfidence,
        premiumContaminationRisk:
          input.antiFakeAssessment.premiumContaminationRisk,
        marketSanityRisk: input.antiFakeAssessment.marketSanityRisk,
        confirmationScore: input.antiFakeAssessment.confirmationScore,
        reasonCodes: input.reasonCodes,
      };
    }

    const warningReasons = new Set<OpportunityReasonCode>([
      'sell_source_requires_listed_exit',
      'steam_snapshot_fallback_used',
      'stale_snapshot_used',
      'backup_reference_outlier',
      'freshness_penalty_elevated',
      'liquidity_penalty_elevated',
      'stale_penalty_elevated',
      'category_penalty_elevated',
      'source_disagreement_penalty_elevated',
      'LOW_MATCH_CONFIDENCE',
      'UNKNOWN_FLOAT_PREMIUM',
      'UNKNOWN_STICKER_PREMIUM',
      'UNKNOWN_PATTERN_PREMIUM',
      'UNKNOWN_PHASE_PREMIUM',
      'STALE_SOURCE_STATE',
      'LOW_SOURCE_CONFIDENCE',
      'OUTLIER_PRICE',
      'INSUFFICIENT_LIQUIDITY',
      'FROZEN_MARKET',
      'NO_CONFIRMING_SOURCE',
    ]);
    const warned =
      input.pairability.status !== 'pairable' ||
      input.reasonCodes.some((reasonCode) => warningReasons.has(reasonCode));

    return {
      status: warned ? 'warned' : 'passed',
      hardReject: input.antiFakeAssessment.hardReject,
      matchConfidence: input.antiFakeAssessment.matchConfidence,
      premiumContaminationRisk:
        input.antiFakeAssessment.premiumContaminationRisk,
      marketSanityRisk: input.antiFakeAssessment.marketSanityRisk,
      confirmationScore: input.antiFakeAssessment.confirmationScore,
      reasonCodes: input.reasonCodes,
    };
  }

  private buildPairability(input: {
    readonly buyRow: MergedMarketMatrixRowDto;
    readonly sellRow: MergedMarketMatrixRowDto;
    readonly reasonCodes: readonly OpportunityReasonCode[];
    readonly schemeBlocked: boolean;
  }): OpportunityPairabilityDto {
    const sameSourceBlocked = input.buyRow.source === input.sellRow.source;
    const listedExitOnly =
      input.sellRow.bid === undefined &&
      (input.sellRow.ask !== undefined ||
        input.reasonCodes.includes('sell_source_requires_listed_exit'));
    const usesFallbackData =
      input.buyRow.fetchMode === 'fallback' ||
      input.sellRow.fetchMode === 'fallback';
    const missingSellSignal =
      input.reasonCodes.includes('sell_source_has_no_exit_signal');
    const missingBuySignal = input.reasonCodes.includes('buy_source_has_no_ask');
    const blocked =
      sameSourceBlocked ||
      input.schemeBlocked ||
      missingSellSignal ||
      missingBuySignal;

    return {
      status: blocked
        ? 'blocked'
        : listedExitOnly
          ? 'listed_exit_only'
          : 'pairable',
      sameSourceBlocked,
      listedExitOnly,
      usesFallbackData,
      schemeBlocked: input.schemeBlocked,
    };
  }

  private buildRankingInputs(input: {
    readonly category: MergedMarketMatrixDto['category'];
    readonly buyRow: MergedMarketMatrixRowDto;
    readonly sellRow: MergedMarketMatrixRowDto;
    readonly expectedNetProfit: number;
    readonly rawSpreadPercent: number;
    readonly finalConfidence: number;
    readonly penalties: OpportunityPenaltyBreakdownDto;
    readonly antiFakeAssessment: AntiFakeAssessment;
    readonly pairability: OpportunityPairabilityDto;
    readonly disposition: OpportunityEvaluationDisposition;
  }): OpportunityRankingInputsDto {
    const categoryPolicy = OPPORTUNITY_CATEGORY_POLICIES[input.category];
    const freshnessScore = this.clampScore(
      1 -
        input.penalties.freshnessPenalty -
        input.penalties.stalePenalty,
    );
    const buyListedQty = input.buyRow.listedQty ?? 0;
    const sellListedQty = input.sellRow.listedQty ?? 0;
    const depthSignal = Math.min(
      1,
      Math.min(buyListedQty, sellListedQty) /
        Math.max(1, categoryPolicy.liquidityTargetDepth),
    );
    const liquidityScore = this.clampScore(
      1 - input.penalties.liquidityPenalty * 0.9 + depthSignal * 0.1,
    );
    const pairabilityScore =
      input.pairability.status === 'blocked'
        ? 0
        : input.pairability.status === 'listed_exit_only'
          ? 0.72
          : 1;
    const variantCertainty = this.clampScore(
      input.antiFakeAssessment.matchConfidence,
    );
    const sourceReliability = this.clampScore(
      Math.sqrt(
        Math.max(0, input.buyRow.sourceConfidence) *
          Math.max(0, input.sellRow.sourceConfidence),
      ) *
        (input.buyRow.agreementState === 'conflicted' ||
        input.sellRow.agreementState === 'conflicted'
          ? 0.8
          : input.buyRow.agreementState === 'divergent' ||
              input.sellRow.agreementState === 'divergent'
            ? 0.93
            : 1),
    );
    const normalizedNetProfit = this.clampScore(
      input.expectedNetProfit / Math.max(categoryPolicy.highUpsideNet, 0.0001),
    );
    const spreadCap = Math.max(
      categoryPolicy.minSpreadPercent * 3,
      categoryPolicy.nearEligibleSpreadPercent * 3,
      8,
    );
    const normalizedSpreadPercent = this.clampScore(
      input.rawSpreadPercent / Math.max(spreadCap, 0.0001),
    );
    const qualityScore =
      100 *
      (0.35 * normalizedNetProfit +
        0.15 * normalizedSpreadPercent +
        0.2 * input.finalConfidence +
        0.1 * liquidityScore +
        0.1 * freshnessScore +
        0.05 * variantCertainty +
        0.05 * sourceReliability);
    const penaltyScore =
      100 *
      (0.12 * input.antiFakeAssessment.riskScore +
        0.06 * input.antiFakeAssessment.premiumContaminationRisk +
        0.05 * input.antiFakeAssessment.marketSanityRisk +
        0.03 * input.penalties.sourceDisagreementPenalty +
        0.03 * input.penalties.stalePenalty +
        (input.pairability.status === 'listed_exit_only' ? 0.08 : 0));
    const bucketBase = this.resolveBucketBase(input.disposition);
    const rankScore =
      input.disposition === 'rejected'
        ? 0
        : this.roundScore(
            bucketBase + qualityScore - penaltyScore + pairabilityScore * 5,
          );

    return {
      dispositionRank: this.rankDisposition(input.disposition),
      bucketBase,
      qualityScore: this.roundScore(qualityScore),
      penaltyScore: this.roundScore(penaltyScore),
      rankScore,
      freshnessScore,
      liquidityScore,
      pairabilityScore: this.roundScore(pairabilityScore),
      variantCertainty,
      sourceReliability,
      feeAdjustedNetProfit: this.roundScore(input.expectedNetProfit),
      feeAdjustedSpreadPercent: this.roundScore(input.rawSpreadPercent),
    };
  }

  private isVariantInSchemeScope(
    matrix: MergedMarketMatrixDto,
    scheme: CompiledScheme,
  ): boolean {
    if (
      scheme.scope.categories.length > 0 &&
      !scheme.scope.categories.includes(matrix.category)
    ) {
      return false;
    }

    if (
      scheme.scope.itemVariantIds.length > 0 &&
      !scheme.scope.itemVariantIds.includes(matrix.itemVariantId)
    ) {
      return false;
    }

    return true;
  }

  private createEmptyAntiFakeAssessment(): AntiFakeAssessment {
    return {
      hardReject: false,
      riskScore: 0,
      matchConfidence: 1,
      premiumContaminationRisk: 0,
      marketSanityRisk: 0,
      confirmationScore: 0,
      reasonCodes: [],
    };
  }

  private resolveBackupConfirmation(
    backupRows: readonly MergedMarketMatrixRowDto[],
    buyCost: number,
    sellSignalPrice: number,
  ):
    | {
        readonly supported: true;
        readonly row: MergedMarketMatrixRowDto;
        readonly referencePrice: number;
        readonly boost: number;
      }
    | {
        readonly supported: false;
        readonly boost: number;
      }
    | null {
    if (backupRows.length === 0) {
      return null;
    }

    const midpoint = (buyCost + sellSignalPrice) / 2;

    for (const backupRow of backupRows) {
      const referencePrice = backupRow.ask ?? backupRow.bid;

      if (referencePrice === undefined) {
        continue;
      }

      const withinSpread =
        referencePrice >= buyCost * 0.98 &&
        referencePrice <= sellSignalPrice * 1.02;
      const nearMidpoint =
        Math.abs(referencePrice - midpoint) / Math.max(0.0001, midpoint) <=
        0.06;

      if (withinSpread && nearMidpoint) {
        return {
          supported: true,
          row: backupRow,
          referencePrice,
          boost: 0.035,
        };
      }
    }

    return {
      supported: false,
      boost: 0,
    };
  }

  private toSourceLeg(row: MergedMarketMatrixRowDto): OpportunitySourceLegDto {
    return {
      source: row.source,
      sourceName: row.sourceName,
      ...(row.marketUrl ? { marketUrl: row.marketUrl } : {}),
      ...(row.listingUrl ? { listingUrl: row.listingUrl } : {}),
      ...(row.ask !== undefined ? { ask: row.ask } : {}),
      ...(row.bid !== undefined ? { bid: row.bid } : {}),
      ...(row.listedQty !== undefined ? { listedQty: row.listedQty } : {}),
      observedAt: row.observedAt,
      fetchMode: row.fetchMode,
      confidence: row.confidence,
      ...(row.snapshotId ? { snapshotId: row.snapshotId } : {}),
      ...(row.rawPayloadArchiveId
        ? { rawPayloadArchiveId: row.rawPayloadArchiveId }
        : {}),
    };
  }

  private createDispositionSummary(): Record<
    OpportunityEvaluationDisposition,
    number
  > {
    return {
      candidate: 0,
      near_eligible: 0,
      eligible: 0,
      risky_high_upside: 0,
      rejected: 0,
    };
  }

  private compareEvaluations(
    left: OpportunityEvaluationDto,
    right: OpportunityEvaluationDto,
  ): number {
    const dispositionRankDifference =
      left.rankingInputs.dispositionRank - right.rankingInputs.dispositionRank;

    if (dispositionRankDifference !== 0) {
      return dispositionRankDifference;
    }

    if (right.rankingInputs.rankScore !== left.rankingInputs.rankScore) {
      return right.rankingInputs.rankScore - left.rankingInputs.rankScore;
    }

    if (right.expectedNetProfit !== left.expectedNetProfit) {
      return right.expectedNetProfit - left.expectedNetProfit;
    }

    if (right.finalConfidence !== left.finalConfidence) {
      return right.finalConfidence - left.finalConfidence;
    }

    return left.opportunityKey.localeCompare(right.opportunityKey);
  }

  private resolveBucketBase(
    disposition: OpportunityEvaluationDisposition,
  ): number {
    switch (disposition) {
      case 'eligible':
        return 400;
      case 'risky_high_upside':
        return 300;
      case 'near_eligible':
        return 200;
      case 'candidate':
        return 100;
      case 'rejected':
        return 0;
    }
  }

  private rankDisposition(
    disposition: OpportunityEvaluationDisposition,
  ): number {
    switch (disposition) {
      case 'eligible':
        return 0;
      case 'risky_high_upside':
        return 1;
      case 'near_eligible':
        return 2;
      case 'candidate':
        return 3;
      case 'rejected':
        return 4;
    }
  }

  private rankRiskClass(riskClass: OpportunityEngineRiskClass): number {
    switch (riskClass) {
      case 'low':
        return 0;
      case 'medium':
        return 1;
      case 'high':
        return 2;
      case 'extreme':
        return 3;
    }
  }

  private uniqueReasonCodes(
    reasonCodes: readonly OpportunityReasonCode[],
  ): readonly OpportunityReasonCode[] {
    return [...new Set(reasonCodes)];
  }

  private roundCurrency(value: number): number {
    return Number(value.toFixed(4));
  }

  private roundScore(value: number): number {
    return Number(value.toFixed(4));
  }

  private toPercent(value: number): number {
    return Number((value * 100).toFixed(4));
  }

  private clampScore(value: number): number {
    return Number(Math.max(0, Math.min(1, value)).toFixed(4));
  }
}
