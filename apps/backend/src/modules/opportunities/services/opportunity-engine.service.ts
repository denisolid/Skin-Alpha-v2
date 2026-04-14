import { Inject, Injectable, Optional } from '@nestjs/common';

import { CatalogAliasNormalizationService } from '../../catalog/services/catalog-alias-normalization.service';
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
  OpportunityComponentScoresDto,
  OpportunityEngineScanResultDto,
  OpportunityEngineVariantResultDto,
  OpportunityEligibilityDto,
  OpportunityEvaluationDto,
  OpportunityExecutionBreakdownDto,
  OpportunityFunnelMetricsDto,
  OpportunityPairabilityDto,
  OpportunityPenaltyBreakdownDto,
  OpportunityPreScoreGateDto,
  OpportunityRankingInputsDto,
  OpportunityRiskReasonDto,
  OpportunitySourceLegDto,
  OpportunityStrictTradableKeyDto,
  OpportunityStrictTradableMatchDto,
  OpportunityValidationDto,
} from '../domain/opportunity-engine.contract';
import {
  OPPORTUNITY_EVALUATION_DISPOSITIONS,
  type OpportunityBlockerReason,
  type OpportunityEvaluationDisposition,
  type OpportunityEngineRiskClass,
  type OpportunityReasonCode,
  type OpportunitySurfaceTier,
} from '../domain/opportunity-engine.model';
import { OPPORTUNITY_CATEGORY_POLICIES } from '../domain/opportunity-engine-policy.model';
import { buildOpportunityKey } from '../domain/opportunity-key';
import { OpportunityAntiFakeService } from './opportunity-anti-fake.service';
import { OpportunityEnginePolicyService } from './opportunity-engine-policy.service';

const DEFAULT_ENGINE_MAX_PAIRS = 12;
const POST_FEE_EDGE_EPSILON = 0.005;
const AGGREGATE_IDENTITY_SOURCES = new Set<
  MergedMarketMatrixRowDto['source']
>(['skinport', 'waxpeer', 'bitskins']);

@Injectable()
export class OpportunityEngineService {
  constructor(
    @Inject(MarketStateMergeService)
    private readonly marketStateMergeService: MarketStateMergeService,
    @Inject(OpportunityEnginePolicyService)
    private readonly opportunityEnginePolicyService: OpportunityEnginePolicyService,
    @Inject(OpportunityAntiFakeService)
    private readonly opportunityAntiFakeService: OpportunityAntiFakeService,
    @Optional()
    @Inject(CatalogAliasNormalizationService)
    private readonly aliasNormalizationService: CatalogAliasNormalizationService = new CatalogAliasNormalizationService(),
  ) {}

  async evaluateVariant(
    itemVariantId: string,
    input: EvaluateOpportunityVariantInput = {},
  ): Promise<OpportunityEngineVariantResultDto> {
    const matrix = await this.marketStateMergeService.getVariantMatrix(
      itemVariantId,
      {
        ...(input.allowHistoricalFallback !== undefined
          ? { allowHistoricalFallback: input.allowHistoricalFallback }
          : {}),
      },
    );

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
    const matrices = await this.marketStateMergeService.getVariantMatrices(
      itemVariantIds,
      {
        ...(input.allowHistoricalFallback !== undefined
          ? { allowHistoricalFallback: input.allowHistoricalFallback }
          : {}),
      },
    );
    const results = matrices.map((matrix) =>
      this.evaluateMatrix({
        matrix,
        includeRejected: input.includeRejected ?? false,
        maxPairs: input.maxPairs ?? DEFAULT_ENGINE_MAX_PAIRS,
        ...(input.scheme ? { scheme: input.scheme } : {}),
      }),
    );
    const dispositionSummary = this.createDispositionSummary();
    const diagnostics = results.reduce(
      (aggregate, result) => ({
        fetched: aggregate.fetched + result.diagnostics.fetched,
        normalized: aggregate.normalized + result.diagnostics.normalized,
        canonicalMatched:
          aggregate.canonicalMatched + result.diagnostics.canonicalMatched,
        pairable: aggregate.pairable + result.diagnostics.pairable,
        candidate: aggregate.candidate + result.diagnostics.candidate,
        eligible: aggregate.eligible + result.diagnostics.eligible,
        surfaced: aggregate.surfaced + result.diagnostics.surfaced,
      }),
      this.createEmptyFunnelMetrics(),
    );

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
      diagnostics,
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
        diagnostics: this.createEmptyFunnelMetrics(),
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

    const diagnostics = {
      fetched: input.matrix.rows.length,
      normalized: input.matrix.rows.filter((row) => this.hasMarketSignal(row))
        .length,
      canonicalMatched: tradableRows.length,
      pairable: allEvaluations.filter(
        (evaluation) =>
          evaluation.strictTradable.matched &&
          evaluation.preScoreGate.passed &&
          evaluation.pairability.status !== 'blocked',
      ).length,
      candidate: allEvaluations.filter(
        (evaluation) => evaluation.disposition !== 'rejected',
      ).length,
      eligible: allEvaluations.filter(
        (evaluation) => evaluation.eligibility.eligible,
      ).length,
      surfaced: sortedEvaluations.filter(
        (evaluation) => evaluation.surfaceTier !== 'rejected',
      ).length,
    } satisfies OpportunityFunnelMetricsDto;

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
      diagnostics,
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
    const strictTradable = this.buildStrictTradableMatch(
      input.matrix,
      input.buyRow,
      input.sellRow,
    );
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
        strictTradable,
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
        strictTradable,
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

    if (!strictTradable.buyKey || !strictTradable.sellKey) {
      return this.buildRejectedEvaluation({
        ...input,
        buyCost: input.buyRow.ask,
        sellSignalPrice,
        antiFakeAssessment: this.createEmptyAntiFakeAssessment(),
        reasonCodes: [...baseReasonCodes, 'strict_variant_key_missing'],
        strictTradable,
      });
    }

    if (!strictTradable.matched) {
      return this.buildRejectedEvaluation({
        ...input,
        buyCost: input.buyRow.ask,
        sellSignalPrice,
        antiFakeAssessment: this.createEmptyAntiFakeAssessment(),
        reasonCodes: [...baseReasonCodes, 'strict_variant_key_mismatch'],
        strictTradable,
      });
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
        strictTradable,
      });
    }

    const buyCost = input.buyRow.ask;
    const rawSpread = this.roundCurrency(sellSignalPrice - buyCost);
    const rawSpreadPercent = this.toPercent(
      rawSpread / Math.max(0.0001, buyCost),
    );

    if (rawSpread < -POST_FEE_EDGE_EPSILON) {
      baseReasonCodes.push('non_positive_raw_spread');
    }

    const buyFeeRate = this.opportunityEnginePolicyService.getBuyFeeRate(
      input.buyRow.source,
    );
    const sellFeeRate = this.opportunityEnginePolicyService.getSellFeeRate(
      input.sellRow.source,
    );
    const normalizedBuyCostAfterFees = buyCost * (1 + buyFeeRate);
    const normalizedExitAfterFees = expectedExitPrice * (1 - sellFeeRate);
    const feesAdjustedSpread = this.roundCurrency(
      normalizedExitAfterFees - normalizedBuyCostAfterFees,
    );
    const postFeeEdgeStatus = this.compareNormalizedEdge({
      exitAfterFees: normalizedExitAfterFees,
      buyCostAfterFees: normalizedBuyCostAfterFees,
    });
    const backupConfirmation = this.resolveBackupConfirmation(
      input.backupRows,
      buyCost,
      sellSignalPrice,
    );
    const preScoreGate = this.evaluatePreScoreGate({
      matrix: input.matrix,
      buyRow: input.buyRow,
      sellRow: input.sellRow,
      backupRows: input.backupRows,
      buyCost,
      sellSignalPrice,
    });

    if (!preScoreGate.passed) {
      return this.buildRejectedEvaluation({
        ...input,
        buyCost,
        sellSignalPrice,
        antiFakeAssessment: this.createEmptyAntiFakeAssessment(),
        reasonCodes: [
          ...baseReasonCodes,
          ...preScoreGate.reasonCodes,
        ] satisfies OpportunityReasonCode[],
        strictTradable,
        preScoreGate,
      });
    }
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
        strictTradable,
        preScoreGate,
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

    const componentScoresWithFinalConfidence =
      this.opportunityEnginePolicyService.buildComponentScores({
        matrix: input.matrix,
        buyRow: input.buyRow,
        sellRow: input.sellRow,
        penalties,
        antiFakeAssessment,
        preScoreGate,
        backupConfirmationBoost: backupConfirmation?.boost ?? 0,
      });
    const componentScores = this.extractComponentScores(
      componentScoresWithFinalConfidence,
    );
    const finalConfidence = componentScoresWithFinalConfidence.finalConfidence;
    const execution = this.opportunityEnginePolicyService.buildExecutionBreakdown({
      category: input.matrix.category,
      buyRow: input.buyRow,
      sellRow: input.sellRow,
      buyPrice: buyCost,
      realizedSellPrice: expectedExitPrice,
      buyFeeRate,
      sellFeeRate,
      penalties,
      antiFakeAssessment,
      finalConfidence,
    });
    const classification =
      this.opportunityEnginePolicyService.classifyOpportunity({
        category: input.matrix.category,
        expectedNetProfit: execution.expectedNet,
        rawSpreadPercent,
        postFeeEdgeStatus,
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
    const eligibility = this.opportunityEnginePolicyService.evaluateEligibility({
      category: input.matrix.category,
      buyRow: input.buyRow,
      sellRow: input.sellRow,
      disposition: classification.disposition,
      pairabilityStatus: pairability.status,
      componentScores,
      finalConfidence,
      expectedNetProfit: execution.expectedNet,
      rawSpreadPercent,
      strictTradable,
      preScoreGate,
      backupConfirmed: backupConfirmation?.supported ?? false,
      reasonCodes: classification.reasonCodes,
    });
    const reasonCodes = [
      ...classification.reasonCodes,
      ...(eligibility.steamSnapshotDemoted
        ? (['steam_snapshot_pair_demoted'] satisfies OpportunityReasonCode[])
        : []),
    ] satisfies OpportunityReasonCode[];
    const riskReasons = this.opportunityEnginePolicyService.buildRiskReasons({
      buyRow: input.buyRow,
      sellRow: input.sellRow,
      penalties,
      preScoreGate,
      strictTradable,
      reasonCodes,
      surfaceTier: eligibility.surfaceTier,
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
      execution,
      componentScores,
      finalConfidence,
      penalties,
      antiFakeAssessment,
      disposition: classification.disposition,
      surfaceTier: eligibility.surfaceTier,
      riskClass: classification.riskClass,
      reasonCodes,
      riskReasons,
      strictTradable,
      preScoreGate,
      eligibility,
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
    readonly execution: OpportunityExecutionBreakdownDto;
    readonly componentScores: OpportunityComponentScoresDto;
    readonly finalConfidence: number;
    readonly penalties: OpportunityPenaltyBreakdownDto;
    readonly antiFakeAssessment: AntiFakeAssessment;
    readonly disposition: OpportunityEvaluationDisposition;
    readonly surfaceTier: OpportunitySurfaceTier;
    readonly riskClass: OpportunityEngineRiskClass;
    readonly reasonCodes: readonly OpportunityReasonCode[];
    readonly riskReasons: readonly OpportunityRiskReasonDto[];
    readonly strictTradable: OpportunityStrictTradableMatchDto;
    readonly preScoreGate: OpportunityPreScoreGateDto;
    readonly eligibility: OpportunityEligibilityDto;
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
      expectedNetProfit: input.execution.expectedNet,
      rawSpreadPercent: input.rawSpreadPercent,
      finalConfidence: input.finalConfidence,
      penalties: input.penalties,
      antiFakeAssessment: input.antiFakeAssessment,
      pairability: input.pairability,
      disposition: input.disposition,
      surfaceTier: input.surfaceTier,
    });

    return {
      opportunityKey: buildOpportunityKey({
        itemVariantId: input.matrix.itemVariantId,
        buySource: input.buyRow.source,
        sellSource: input.sellRow.source,
      }),
      disposition: input.disposition,
      surfaceTier: input.surfaceTier,
      reasonCodes,
      riskClass: input.riskClass,
      riskReasons: input.riskReasons,
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
      expectedNetProfit: input.execution.expectedNet,
      expectedExitPrice: input.expectedExitPrice,
      estimatedSellFeeRate: input.sellFeeRate,
      buyCost: input.buyCost,
      sellSignalPrice: input.sellSignalPrice,
      componentScores: input.componentScores,
      execution: input.execution,
      finalConfidence: input.finalConfidence,
      penalties: input.penalties,
      antiFakeAssessment: input.antiFakeAssessment,
      strictTradable: input.strictTradable,
      preScoreGate: input.preScoreGate,
      eligibility: input.eligibility,
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
    readonly strictTradable?: OpportunityStrictTradableMatchDto;
    readonly preScoreGate?: OpportunityPreScoreGateDto;
    readonly scheme?: CompiledScheme;
  }): OpportunityEvaluationDto {
    const strictTradable =
      input.strictTradable ??
      this.buildStrictTradableMatch(input.matrix, input.buyRow, input.sellRow);
    const preScoreGate =
      input.preScoreGate ??
      this.createDefaultPreScoreGate(input.reasonCodes);
    const componentScores = this.createDefaultComponentScores();
    const execution = this.createDefaultExecutionBreakdown(input.buyCost);
    const reasonCodes = this.uniqueReasonCodes(input.reasonCodes);
    const eligibility = this.createRejectedEligibility(reasonCodes);

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
      execution,
      componentScores,
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
      surfaceTier: 'rejected',
      riskClass: 'extreme',
      reasonCodes,
      riskReasons: this.opportunityEnginePolicyService.buildRiskReasons({
        buyRow: input.buyRow,
        sellRow: input.sellRow,
        penalties: {
          freshnessPenalty: 0,
          liquidityPenalty: 0,
          stalePenalty: 0,
          categoryPenalty: 0,
          sourceDisagreementPenalty: 0,
          backupConfirmationBoost: 0,
          totalPenalty: 0,
        },
        preScoreGate,
        strictTradable,
        reasonCodes,
        surfaceTier: 'rejected',
      }),
      strictTradable,
      preScoreGate,
      eligibility,
      pairability: this.buildPairability({
        buyRow: input.buyRow,
        sellRow: input.sellRow,
        reasonCodes,
        schemeBlocked: reasonCodes.some((reasonCode) =>
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
      execution: evaluation.execution,
      componentScores: evaluation.componentScores,
      finalConfidence: evaluation.finalConfidence,
      penalties: evaluation.penalties,
      antiFakeAssessment: evaluation.antiFakeAssessment,
      disposition: 'rejected',
      surfaceTier: 'rejected',
      riskClass: evaluation.riskClass,
      reasonCodes: [...evaluation.reasonCodes, ...schemeReasonCodes],
      riskReasons: evaluation.riskReasons,
      strictTradable: evaluation.strictTradable,
      preScoreGate: evaluation.preScoreGate,
      eligibility: {
        ...evaluation.eligibility,
        surfaceTier: 'rejected',
        eligible: false,
      },
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
      'steam_snapshot_pair_demoted',
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
      'near_equal_after_fees',
      'strict_variant_key_missing',
      'strict_variant_key_mismatch',
      'pre_score_outlier_rejected',
      'insufficient_comparable_sources',
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

  private compareNormalizedEdge(input: {
    readonly exitAfterFees: number;
    readonly buyCostAfterFees: number;
  }): 'positive' | 'near_equal' | 'non_positive' {
    const delta = input.exitAfterFees - input.buyCostAfterFees;

    if (delta < -POST_FEE_EDGE_EPSILON) {
      return 'non_positive';
    }

    if (Math.abs(delta) <= POST_FEE_EDGE_EPSILON) {
      return 'near_equal';
    }

    return 'positive';
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
    readonly surfaceTier: OpportunitySurfaceTier;
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
      surfaceTierRank: this.rankSurfaceTier(input.surfaceTier),
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

  private createDefaultComponentScores(): OpportunityComponentScoresDto {
    return {
      mappingConfidence: 0,
      priceConfidence: 0,
      liquidityConfidence: 0,
      freshnessConfidence: 0,
      sourceReliabilityConfidence: 0,
      variantMatchConfidence: 0,
    };
  }

  private createDefaultExecutionBreakdown(
    buyPrice: number,
  ): OpportunityExecutionBreakdownDto {
    return {
      realizedSellPrice: 0,
      buyPrice: this.roundCurrency(buyPrice),
      fees: 0,
      slippagePenalty: 0,
      liquidityPenalty: 0,
      uncertaintyPenalty: 0,
      expectedNet: 0,
    };
  }

  private extractComponentScores(input: OpportunityComponentScoresDto & {
    readonly finalConfidence: number;
  }): OpportunityComponentScoresDto {
    return {
      mappingConfidence: input.mappingConfidence,
      priceConfidence: input.priceConfidence,
      liquidityConfidence: input.liquidityConfidence,
      freshnessConfidence: input.freshnessConfidence,
      sourceReliabilityConfidence: input.sourceReliabilityConfidence,
      variantMatchConfidence: input.variantMatchConfidence,
    };
  }

  private createDefaultPreScoreGate(
    reasonCodes: readonly OpportunityReasonCode[] = [],
  ): OpportunityPreScoreGateDto {
    return {
      passed: false,
      comparableCount: 0,
      rejectedByStale: reasonCodes.includes('stale_pre_score_rejection'),
      rejectedByMedian: reasonCodes.includes('source_median_outlier_rejected'),
      rejectedByConsensus: reasonCodes.includes(
        'cross_source_consensus_outlier_rejected',
      ),
      rejectedByComparableCount: reasonCodes.includes(
        'insufficient_comparable_sources',
      ),
      reasonCodes,
    };
  }

  private createRejectedEligibility(
    reasonCodes: readonly OpportunityReasonCode[],
  ): OpportunityEligibilityDto {
    return {
      surfaceTier: 'rejected',
      eligible: false,
      requiresReferenceSupport: false,
      steamSnapshotDemoted: false,
      ...(this.resolveRejectedBlockerReason(reasonCodes)
        ? { blockerReason: this.resolveRejectedBlockerReason(reasonCodes)! }
        : {}),
    };
  }

  private resolveRejectedBlockerReason(
    reasonCodes: readonly OpportunityReasonCode[],
  ): OpportunityBlockerReason | undefined {
    if (reasonCodes.includes('strict_variant_key_mismatch')) {
      return 'strict_variant_key_mismatch';
    }

    if (reasonCodes.includes('strict_variant_key_missing')) {
      return 'strict_variant_key_missing';
    }

    if (
      reasonCodes.includes('pre_score_outlier_rejected') ||
      reasonCodes.includes('source_median_outlier_rejected') ||
      reasonCodes.includes('cross_source_consensus_outlier_rejected')
    ) {
      return 'pre_score_outlier';
    }

    if (reasonCodes.includes('insufficient_comparable_sources')) {
      return 'insufficient_comparables';
    }

    if (
      reasonCodes.includes('stale_pre_score_rejection') ||
      reasonCodes.includes('STALE_SOURCE_STATE')
    ) {
      return 'stale_sources';
    }

    if (reasonCodes.includes('sell_source_requires_listed_exit')) {
      return 'listed_exit_only';
    }

    if (
      reasonCodes.includes('steam_snapshot_fallback_used') ||
      reasonCodes.includes('steam_snapshot_pair_demoted')
    ) {
      return 'steam_snapshot_pair';
    }

    if (reasonCodes.includes('stale_snapshot_used')) {
      return 'fallback_data';
    }

    return undefined;
  }

  private buildStrictTradableMatch(
    matrix: MergedMarketMatrixDto,
    buyRow: MergedMarketMatrixRowDto,
    sellRow: MergedMarketMatrixRowDto,
  ): OpportunityStrictTradableMatchDto {
    const buyKey = this.buildStrictTradableKey(matrix, buyRow);
    const sellKey = this.buildStrictTradableKey(matrix, sellRow);

    return {
      matched:
        buyKey !== undefined &&
        sellKey !== undefined &&
        this.strictTradableKeysMatch({
          matrix,
          buyRow,
          sellRow,
          buyKey,
          sellKey,
        }),
      ...(buyKey ? { buyKey } : {}),
      ...(sellKey ? { sellKey } : {}),
    };
  }

  private buildStrictTradableKey(
    matrix: MergedMarketMatrixDto,
    row: MergedMarketMatrixRowDto,
  ): OpportunityStrictTradableKeyDto | undefined {
    const condition = this.normalizeStrictConditionToken(
      row.identity?.condition ??
        matrix.variantIdentity.exterior ??
        this.resolveDefaultStrictCondition(matrix),
    );

    if (!condition) {
      return undefined;
    }

    const phaseFamily =
      matrix.variantIdentity.phaseFamily === 'gamma-doppler'
        ? 'gamma'
        : matrix.variantIdentity.phaseFamily;
    const phaseValue = this.normalizeStrictPhaseToken(
      row.identity?.phase ?? matrix.variantIdentity.phaseLabel ?? 'standard',
    );
    const patternSensitiveBucket = matrix.variantIdentity.patternRelevant
      ? row.identity?.paintSeed !== undefined
        ? `seed-${row.identity.paintSeed}`
        : 'pattern-unknown'
      : 'pattern-none';
    const floatBucket = matrix.variantIdentity.floatRelevant
      ? this.resolveFloatBucket(row, condition)
      : 'float-none';
    const key = [
      matrix.canonicalItemId,
      condition,
      `stattrak-${row.identity?.isStatTrak ?? matrix.variantIdentity.stattrak ? 'yes' : 'no'}`,
      `souvenir-${row.identity?.isSouvenir ?? matrix.variantIdentity.souvenir ? 'yes' : 'no'}`,
      `vanilla-${matrix.variantIdentity.isVanilla ? 'yes' : 'no'}`,
      `${phaseFamily}-${phaseValue ?? 'phase-unknown'}`,
      patternSensitiveBucket,
      floatBucket,
    ].join('|');

    return {
      key,
      condition,
      stattrak: row.identity?.isStatTrak ?? matrix.variantIdentity.stattrak,
      souvenir: row.identity?.isSouvenir ?? matrix.variantIdentity.souvenir,
      vanilla: matrix.variantIdentity.isVanilla,
      phase: `${phaseFamily}-${phaseValue ?? 'phase-unknown'}`,
      patternSensitiveBucket,
      floatBucket,
    };
  }

  private resolveFloatBucket(
    row: MergedMarketMatrixRowDto,
    condition: string,
  ): string {
    if (row.identity?.wearFloat === undefined) {
      return `float-${condition}`;
    }

    const wearFloat = row.identity.wearFloat;

    if (wearFloat <= 0.03) {
      return 'float-00-003';
    }

    if (wearFloat <= 0.07) {
      return 'float-003-007';
    }

    if (wearFloat <= 0.15) {
      return 'float-007-015';
    }

    if (wearFloat <= 0.38) {
      return 'float-015-038';
    }

    if (wearFloat <= 0.45) {
      return 'float-038-045';
    }

    return 'float-045-plus';
  }

  private resolveDefaultStrictCondition(
    matrix: MergedMarketMatrixDto,
  ): string | undefined {
    if (matrix.category === 'CASE' || matrix.category === 'CAPSULE') {
      return 'default';
    }

    if (matrix.variantIdentity.isVanilla) {
      return 'default';
    }

    if (!matrix.variantIdentity.floatRelevant && !matrix.variantIdentity.exterior) {
      return 'default';
    }

    return undefined;
  }

  private normalizeKeyToken(value?: string): string | undefined {
    return value
      ? value
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/gu, '-')
          .replace(/^-+|-+$/gu, '')
      : undefined;
  }

  private normalizeStrictConditionToken(value?: string): string | undefined {
    const normalizedExterior =
      this.aliasNormalizationService.normalizeExterior(value);

    return this.normalizeKeyToken(normalizedExterior ?? value);
  }

  private normalizeStrictPhaseToken(value?: string): string | undefined {
    if (!value || value === 'standard') {
      return this.normalizeKeyToken(value);
    }

    const phaseLabel = this.aliasNormalizationService.normalizePhaseHint(value);

    return this.normalizeKeyToken(phaseLabel ?? value);
  }

  private strictTradableKeysMatch(input: {
    readonly matrix: MergedMarketMatrixDto;
    readonly buyRow: MergedMarketMatrixRowDto;
    readonly sellRow: MergedMarketMatrixRowDto;
    readonly buyKey: OpportunityStrictTradableKeyDto;
    readonly sellKey: OpportunityStrictTradableKeyDto;
  }): boolean {
    if (
      input.buyKey.condition !== input.sellKey.condition ||
      input.buyKey.stattrak !== input.sellKey.stattrak ||
      input.buyKey.souvenir !== input.sellKey.souvenir ||
      input.buyKey.vanilla !== input.sellKey.vanilla ||
      input.buyKey.phase !== input.sellKey.phase
    ) {
      return false;
    }

    if (!this.patternSignalsMatch(input)) {
      return false;
    }

    if (!this.floatSignalsMatch(input)) {
      return false;
    }

    return true;
  }

  private patternSignalsMatch(input: {
    readonly matrix: MergedMarketMatrixDto;
    readonly buyRow: MergedMarketMatrixRowDto;
    readonly sellRow: MergedMarketMatrixRowDto;
  }): boolean {
    if (!input.matrix.variantIdentity.patternRelevant) {
      return true;
    }

    const buySeed = input.buyRow.identity?.paintSeed;
    const sellSeed = input.sellRow.identity?.paintSeed;

    if (buySeed !== undefined && sellSeed !== undefined) {
      return buySeed === sellSeed;
    }

    if (buySeed === undefined && sellSeed === undefined) {
      return true;
    }

    return this.isAggregateIdentityRow(
      buySeed === undefined ? input.buyRow : input.sellRow,
    );
  }

  private floatSignalsMatch(input: {
    readonly matrix: MergedMarketMatrixDto;
    readonly buyRow: MergedMarketMatrixRowDto;
    readonly sellRow: MergedMarketMatrixRowDto;
    readonly buyKey: OpportunityStrictTradableKeyDto;
    readonly sellKey: OpportunityStrictTradableKeyDto;
  }): boolean {
    if (!input.matrix.variantIdentity.floatRelevant) {
      return true;
    }

    const buyFloat = input.buyRow.identity?.wearFloat;
    const sellFloat = input.sellRow.identity?.wearFloat;

    if (buyFloat !== undefined && sellFloat !== undefined) {
      return input.buyKey.floatBucket === input.sellKey.floatBucket;
    }

    if (buyFloat === undefined && sellFloat === undefined) {
      return true;
    }

    return this.isAggregateIdentityRow(
      buyFloat === undefined ? input.buyRow : input.sellRow,
    );
  }

  private isAggregateIdentityRow(row: MergedMarketMatrixRowDto): boolean {
    const identity = row.identity;

    if (!identity) {
      return row.fetchMode !== 'live';
    }

    const lacksPatternAndFloatSignals =
      identity.paintSeed === undefined && identity.wearFloat === undefined;

    if (!lacksPatternAndFloatSignals) {
      return false;
    }

    if (row.fetchMode !== 'live') {
      return true;
    }

    if (identity.hasSellerMetadata || identity.hasScmHints) {
      return false;
    }

    if (AGGREGATE_IDENTITY_SOURCES.has(row.source)) {
      return true;
    }

    return (row.listedQty ?? 0) !== 1;
  }

  private evaluatePreScoreGate(input: {
    readonly matrix: MergedMarketMatrixDto;
    readonly buyRow: MergedMarketMatrixRowDto;
    readonly sellRow: MergedMarketMatrixRowDto;
    readonly backupRows: readonly MergedMarketMatrixRowDto[];
    readonly buyCost: number;
    readonly sellSignalPrice: number;
  }): OpportunityPreScoreGateDto {
    const comparableRows = input.matrix.rows.filter(
      (row) =>
        row.fetchMode !== 'backup' &&
        row.freshness.usable &&
        this.resolveComparablePrice(row) !== undefined,
    );
    const comparablePrices = comparableRows
      .map((row) => this.resolveComparablePrice(row))
      .filter((value): value is number => value !== undefined)
      .sort((left, right) => left - right);
    const comparableCount = comparablePrices.length;
    const sourceMedian =
      comparablePrices.length > 0
        ? this.median(comparablePrices)
        : undefined;
    const crossSourceConsensus =
      input.matrix.conflict.consensusAsk ?? sourceMedian;
    const pairMultiple =
      input.sellSignalPrice / Math.max(0.0001, input.buyCost);
    const rejectedByStale =
      !input.buyRow.freshness.usable || !input.sellRow.freshness.usable;
    const rejectedByComparableCount =
      pairMultiple >= 1.22 &&
      comparableCount < 3 &&
      input.backupRows.length === 0;
    const rejectedByMedian =
      sourceMedian !== undefined &&
      pairMultiple >= 1.12 &&
      (input.buyCost < sourceMedian * 0.72 ||
        input.sellSignalPrice > sourceMedian * 1.34);
    const rejectedByConsensus =
      crossSourceConsensus !== undefined &&
      pairMultiple >= 1.12 &&
      input.sellSignalPrice > crossSourceConsensus * 1.3;
    const reasonCodes: OpportunityReasonCode[] = [];

    if (rejectedByStale) {
      reasonCodes.push('stale_pre_score_rejection');
    }

    if (rejectedByMedian) {
      reasonCodes.push('source_median_outlier_rejected');
    }

    if (rejectedByConsensus) {
      reasonCodes.push('cross_source_consensus_outlier_rejected');
    }

    if (rejectedByComparableCount) {
      reasonCodes.push('insufficient_comparable_sources');
    }

    if (
      rejectedByMedian ||
      rejectedByConsensus ||
      rejectedByComparableCount
    ) {
      reasonCodes.unshift('pre_score_outlier_rejected');
    }

    return {
      passed: !rejectedByStale && !reasonCodes.length,
      comparableCount,
      ...(sourceMedian !== undefined ? { sourceMedian } : {}),
      ...(crossSourceConsensus !== undefined ? { crossSourceConsensus } : {}),
      rejectedByStale,
      rejectedByMedian,
      rejectedByConsensus,
      rejectedByComparableCount,
      reasonCodes,
    };
  }

  private resolveComparablePrice(
    row: MergedMarketMatrixRowDto,
  ): number | undefined {
    return row.bid ?? row.ask;
  }

  private median(values: readonly number[]): number {
    const middleIndex = Math.floor(values.length / 2);

    if (values.length % 2 === 1) {
      return values[middleIndex]!;
    }

    return (values[middleIndex - 1]! + values[middleIndex]!) / 2;
  }

  private hasMarketSignal(row: MergedMarketMatrixRowDto): boolean {
    return (
      row.ask !== undefined ||
      row.bid !== undefined ||
      (row.listedQty !== undefined && row.listedQty > 0)
    );
  }

  private createEmptyFunnelMetrics(): OpportunityFunnelMetricsDto {
    return {
      fetched: 0,
      normalized: 0,
      canonicalMatched: 0,
      pairable: 0,
      candidate: 0,
      eligible: 0,
      surfaced: 0,
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
    const surfaceTierRankDifference =
      left.rankingInputs.surfaceTierRank - right.rankingInputs.surfaceTierRank;

    if (surfaceTierRankDifference !== 0) {
      return surfaceTierRankDifference;
    }

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

  private rankSurfaceTier(surfaceTier: OpportunitySurfaceTier): number {
    switch (surfaceTier) {
      case 'tradable':
        return 0;
      case 'reference_backed':
        return 1;
      case 'near_eligible':
        return 2;
      case 'research':
        return 3;
      case 'rejected':
        return 4;
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
