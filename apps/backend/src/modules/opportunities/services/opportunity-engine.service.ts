import { Inject, Injectable } from '@nestjs/common';

import type {
  MergedMarketMatrixDto,
  MergedMarketMatrixRowDto,
} from '../../market-state/dto/merged-market-matrix.dto';
import { MarketStateMergeService } from '../../market-state/services/market-state-merge.service';
import type { AntiFakeAssessment } from '../domain/anti-fake.model';
import type {
  OpportunityEvaluationDisposition,
  OpportunityReasonCode,
} from '../domain/opportunity-engine.model';
import { OPPORTUNITY_EVALUATION_DISPOSITIONS } from '../domain/opportunity-engine.model';
import type {
  GetOpportunityEngineQueryDto,
  GetVariantOpportunityEngineQueryDto,
} from '../dto/get-opportunity-engine.query.dto';
import type {
  OpportunityEngineScanResultDto,
  OpportunityEngineVariantResultDto,
  OpportunityEvaluationDto,
  OpportunitySourceLegDto,
} from '../dto/opportunity-engine.dto';
import { OpportunityEnginePolicyService } from './opportunity-engine-policy.service';
import { OpportunityAntiFakeService } from './opportunity-anti-fake.service';
import { ScannerUniverseService } from './scanner-universe.service';

const DEFAULT_ENGINE_ITEM_LIMIT = 25;
const DEFAULT_ENGINE_MAX_PAIRS = 12;

@Injectable()
export class OpportunityEngineService {
  constructor(
    @Inject(MarketStateMergeService)
    private readonly marketStateMergeService: MarketStateMergeService,
    @Inject(ScannerUniverseService)
    private readonly scannerUniverseService: ScannerUniverseService,
    @Inject(OpportunityEnginePolicyService)
    private readonly opportunityEnginePolicyService: OpportunityEnginePolicyService,
    @Inject(OpportunityAntiFakeService)
    private readonly opportunityAntiFakeService: OpportunityAntiFakeService,
  ) {}

  async evaluateVariant(
    itemVariantId: string,
    query: GetVariantOpportunityEngineQueryDto = {},
  ): Promise<OpportunityEngineVariantResultDto> {
    // Opportunity evaluation runs exclusively on merged internal market state.
    const matrix =
      await this.marketStateMergeService.getVariantMatrix(itemVariantId);

    return this.evaluateMatrix(matrix, {
      includeRejected: query.includeRejected ?? false,
      maxPairs: query.maxPairs ?? DEFAULT_ENGINE_MAX_PAIRS,
    });
  }

  async evaluateScannerUniverse(
    query: GetOpportunityEngineQueryDto = {},
  ): Promise<OpportunityEngineScanResultDto> {
    const generatedAt = new Date();
    const universe = await this.scannerUniverseService.getScannerUniverse({
      ...(query.tier ? { tier: query.tier } : {}),
      ...(query.category ? { category: query.category } : {}),
      limit: query.limit ?? DEFAULT_ENGINE_ITEM_LIMIT,
    });
    const results = await Promise.all(
      universe.items.map((item) =>
        this.evaluateVariant(item.itemVariantId, {
          ...(query.includeRejected !== undefined
            ? { includeRejected: query.includeRejected }
            : {}),
          ...(query.maxPairsPerItem !== undefined
            ? { maxPairs: query.maxPairsPerItem }
            : {}),
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
    const antiFakeCounters = results.reduce(
      (counters, result) => ({
        rejectedByMismatch:
          counters.rejectedByMismatch +
          result.antiFakeCounters.rejectedByMismatch,
        rejectedByPremiumContamination:
          counters.rejectedByPremiumContamination +
          result.antiFakeCounters.rejectedByPremiumContamination,
        rejectedByStaleState:
          counters.rejectedByStaleState +
          result.antiFakeCounters.rejectedByStaleState,
        rejectedByLowConfidence:
          counters.rejectedByLowConfidence +
          result.antiFakeCounters.rejectedByLowConfidence,
        rejectedByLiquidity:
          counters.rejectedByLiquidity +
          result.antiFakeCounters.rejectedByLiquidity,
        rejectedByOutlier:
          counters.rejectedByOutlier +
          result.antiFakeCounters.rejectedByOutlier,
        downgradedToRiskyHighUpside:
          counters.downgradedToRiskyHighUpside +
          result.antiFakeCounters.downgradedToRiskyHighUpside,
      }),
      this.opportunityAntiFakeService.createCounters([]),
    );

    return {
      generatedAt,
      evaluatedItemCount: results.length,
      evaluatedPairCount: results.reduce(
        (total, result) => total + result.evaluatedPairCount,
        0,
      ),
      dispositionSummary,
      antiFakeCounters,
      results,
    };
  }

  private evaluateMatrix(
    matrix: MergedMarketMatrixDto,
    options: {
      readonly includeRejected: boolean;
      readonly maxPairs: number;
    },
  ): OpportunityEngineVariantResultDto {
    const tradableRows = matrix.rows.filter(
      (row) => row.fetchMode !== 'backup',
    );
    const backupRows = matrix.rows.filter((row) => row.fetchMode === 'backup');
    const allEvaluations: OpportunityEvaluationDto[] = [];

    for (const buyRow of tradableRows) {
      for (const sellRow of tradableRows) {
        if (buyRow.source === sellRow.source) {
          continue;
        }

        const evaluation = this.evaluatePair({
          matrix,
          category: matrix.category,
          buyRow,
          sellRow,
          backupRows,
        });

        allEvaluations.push(evaluation);
      }
    }

    const sortedEvaluations = allEvaluations
      .filter((evaluation) =>
        options.includeRejected ? true : evaluation.disposition !== 'rejected',
      )
      .sort((left, right) => this.compareEvaluations(left, right))
      .slice(0, options.maxPairs);
    const dispositionSummary = this.createDispositionSummary();

    for (const evaluation of allEvaluations) {
      dispositionSummary[evaluation.disposition] += 1;
    }

    return {
      generatedAt: matrix.generatedAt,
      category: matrix.category,
      canonicalItemId: matrix.canonicalItemId,
      canonicalDisplayName: matrix.canonicalDisplayName,
      itemVariantId: matrix.itemVariantId,
      variantDisplayName: matrix.variantDisplayName,
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
    readonly category: MergedMarketMatrixDto['category'];
    readonly buyRow: MergedMarketMatrixRowDto;
    readonly sellRow: MergedMarketMatrixRowDto;
    readonly backupRows: readonly MergedMarketMatrixRowDto[];
  }): OpportunityEvaluationDto {
    const baseReasonCodes: OpportunityReasonCode[] = [];

    if (input.buyRow.source === input.sellRow.source) {
      return this.buildRejectedEvaluation({
        ...input,
        buyCost: input.buyRow.ask ?? 0,
        sellSignalPrice: input.sellRow.bid ?? input.sellRow.ask ?? 0,
        antiFakeAssessment: this.createEmptyAntiFakeAssessment(),
        reasonCodes: ['buy_sell_same_source'],
      });
    }

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

    if (input.sellRow.bid === undefined) {
      baseReasonCodes.push('sell_source_requires_listed_exit');
    }

    if (
      input.buyRow.fetchMode === 'fallback' ||
      input.sellRow.fetchMode === 'fallback'
    ) {
      baseReasonCodes.push(
        input.buyRow.source === 'steam-snapshot' ||
          input.sellRow.source === 'steam-snapshot'
          ? 'steam_snapshot_fallback_used'
          : 'stale_snapshot_used',
      );
    }

    const expectedExitPrice =
      this.opportunityEnginePolicyService.getExpectedExitPrice(
        input.category,
        input.sellRow,
      );

    if (expectedExitPrice === null) {
      return this.buildRejectedEvaluation({
        ...input,
        buyCost: input.buyRow.ask,
        sellSignalPrice,
        antiFakeAssessment: this.createEmptyAntiFakeAssessment(),
        reasonCodes: ['sell_source_has_no_exit_signal'],
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
      category: input.category,
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
    const reasonCodes = [
      ...baseReasonCodes,
      ...antiFakeAssessment.reasonCodes,
    ] satisfies OpportunityReasonCode[];

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
        category: input.category,
        expectedNetProfit: feesAdjustedSpread,
        rawSpreadPercent,
        finalConfidence,
        antiFakeAssessment,
        penalties,
        reasonCodes,
      });

    return {
      disposition: classification.disposition,
      reasonCodes: classification.reasonCodes,
      riskClass: classification.riskClass,
      category: input.category,
      canonicalItemId: input.matrix.canonicalItemId,
      canonicalDisplayName: input.matrix.canonicalDisplayName,
      itemVariantId: input.matrix.itemVariantId,
      variantDisplayName: input.matrix.variantDisplayName,
      sourcePairKey: `${input.buyRow.source}->${input.sellRow.source}`,
      buy: this.toSourceLeg(input.buyRow),
      sell: this.toSourceLeg(input.sellRow),
      rawSpread,
      rawSpreadPercent,
      feesAdjustedSpread,
      expectedNetProfit: feesAdjustedSpread,
      expectedExitPrice,
      estimatedSellFeeRate: sellFeeRate,
      buyCost,
      sellSignalPrice,
      finalConfidence,
      penalties,
      antiFakeAssessment,
      ...(backupConfirmation?.supported
        ? {
            backupConfirmation: {
              source: backupConfirmation.row.source,
              sourceName: backupConfirmation.row.sourceName,
              referencePrice: backupConfirmation.referencePrice,
            },
          }
        : {}),
    };
  }

  private buildRejectedEvaluation(input: {
    readonly matrix: MergedMarketMatrixDto;
    readonly category: MergedMarketMatrixDto['category'];
    readonly buyRow: MergedMarketMatrixRowDto;
    readonly sellRow: MergedMarketMatrixRowDto;
    readonly buyCost: number;
    readonly sellSignalPrice: number;
    readonly antiFakeAssessment: AntiFakeAssessment;
    readonly reasonCodes: readonly OpportunityReasonCode[];
  }): OpportunityEvaluationDto {
    return {
      disposition: 'rejected',
      reasonCodes: input.reasonCodes,
      riskClass: 'extreme',
      category: input.category,
      canonicalItemId: input.matrix.canonicalItemId,
      canonicalDisplayName: input.matrix.canonicalDisplayName,
      itemVariantId: input.matrix.itemVariantId,
      variantDisplayName: input.matrix.variantDisplayName,
      sourcePairKey: `${input.buyRow.source}->${input.sellRow.source}`,
      buy: this.toSourceLeg(input.buyRow),
      sell: this.toSourceLeg(input.sellRow),
      rawSpread: 0,
      rawSpreadPercent: 0,
      feesAdjustedSpread: 0,
      expectedNetProfit: 0,
      expectedExitPrice: 0,
      estimatedSellFeeRate: 0,
      buyCost: input.buyCost,
      sellSignalPrice: input.sellSignalPrice,
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
    };
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
      this.rankDisposition(left.disposition) -
      this.rankDisposition(right.disposition);

    if (dispositionRankDifference !== 0) {
      return dispositionRankDifference;
    }

    if (right.expectedNetProfit !== left.expectedNetProfit) {
      return right.expectedNetProfit - left.expectedNetProfit;
    }

    if (right.finalConfidence !== left.finalConfidence) {
      return right.finalConfidence - left.finalConfidence;
    }

    return left.sourcePairKey.localeCompare(right.sourcePairKey);
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

  private roundCurrency(value: number): number {
    return Number(value.toFixed(4));
  }

  private toPercent(value: number): number {
    return Number((value * 100).toFixed(4));
  }
}
