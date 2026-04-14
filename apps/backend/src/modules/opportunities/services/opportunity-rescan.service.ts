import { OpportunityStatus, Prisma } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { OpportunityEvaluationDto } from '../dto/opportunity-engine.dto';
import type { OpportunityRescanResultDto } from '../dto/opportunity-rescan-result.dto';
import type {
  OpportunityBlockerReason,
  OpportunityReasonCode,
} from '../domain/opportunity-engine.model';
import { OpportunityEngineService } from './opportunity-engine.service';

const OPPORTUNITY_RESCAN_MAX_PAIRS = 64;
const OPPORTUNITY_RESCAN_TOP_REASON_LIMIT = 10;
const MATERIALIZED_OPPORTUNITY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BOUNDED_OPPORTUNITY_RESCAN_VARIANTS = 1_000;

interface OpportunityRescanOptions {
  readonly variantLimit?: number;
}

@Injectable()
export class OpportunityRescanService {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(OpportunityEngineService)
    private readonly opportunityEngineService: OpportunityEngineService,
  ) {}

  async rescanAndPersist(
    options: OpportunityRescanOptions = {},
  ): Promise<OpportunityRescanResultDto> {
    const generatedAt = new Date();
    const variantLimit = this.normalizeVariantLimit(options.variantLimit);
    const itemVariants = await this.prismaService.itemVariant.findMany({
      where: {
        marketStates: {
          some: {},
        },
      },
      select: {
        id: true,
      },
      orderBy: [
        {
          updatedAt: 'desc',
        },
        {
          sortOrder: 'asc',
        },
      ],
      ...(variantLimit ? { take: variantLimit } : {}),
    });
    const engineResult = await this.opportunityEngineService.evaluateVariants({
      itemVariantIds: itemVariants.map((itemVariant) => itemVariant.id),
      includeRejected: true,
      maxPairs: OPPORTUNITY_RESCAN_MAX_PAIRS,
      allowHistoricalFallback: false,
    });
    const allEvaluations = engineResult.results.flatMap(
      (result) => result.evaluations,
    );
    const materializableEvaluations = allEvaluations.filter(
      (evaluation) => evaluation.disposition !== 'rejected',
    );
    const rejectedEvaluations = allEvaluations.filter(
      (evaluation) => evaluation.disposition === 'rejected',
    );
    const relevantSourceCodes = [
      ...new Set(
        materializableEvaluations.flatMap((evaluation) => [
          evaluation.buy.source,
          evaluation.sell.source,
        ]),
      ),
    ];
    const sources = relevantSourceCodes.length
      ? await this.prismaService.source.findMany({
          where: {
            code: {
              in: relevantSourceCodes,
            },
          },
          select: {
            id: true,
            code: true,
          },
        })
      : [];
    const sourceIdsByCode = new Map(
      sources.map((source) => [source.code, source.id] as const),
    );
    const expiredResult = await this.prismaService.opportunity.updateMany({
      where: {
        status: OpportunityStatus.OPEN,
        OR: [
          {
            expiresAt: {
              lte: generatedAt,
            },
          },
          {
            detectedAt: {
              lt: new Date(generatedAt.getTime() - MATERIALIZED_OPPORTUNITY_TTL_MS),
            },
          },
        ],
      },
      data: {
        status: OpportunityStatus.EXPIRED,
        expiresAt: generatedAt,
      },
    });
    let persistedOpportunityCount = 0;
    let skippedMissingSnapshotCount = 0;

    for (const evaluation of materializableEvaluations) {
      const materialized = await this.materializeEvaluation(
        evaluation,
        generatedAt,
        sourceIdsByCode,
      );

      if (materialized) {
        persistedOpportunityCount += 1;
      } else {
        skippedMissingSnapshotCount += 1;
      }
    }

    return {
      scannedVariantCount: itemVariants.length,
      evaluatedPairCount: engineResult.evaluatedPairCount,
      openOpportunityCount: materializableEvaluations.length,
      persistedOpportunityCount,
      expiredOpportunityCount: expiredResult.count,
      skippedMissingSnapshotCount,
      variantFunnel: {
        scanned: engineResult.results.length,
        withFetchedRows: engineResult.results.filter(
          (result) => result.diagnostics.fetched > 0,
        ).length,
        withNormalizedRows: engineResult.results.filter(
          (result) => result.diagnostics.normalized > 0,
        ).length,
        withCanonicalMatchedRows: engineResult.results.filter(
          (result) => result.diagnostics.canonicalMatched > 0,
        ).length,
        withEvaluatedPairs: engineResult.results.filter(
          (result) => result.evaluatedPairCount > 0,
        ).length,
        withPairablePairs: engineResult.results.filter(
          (result) => result.diagnostics.pairable > 0,
        ).length,
        withCandidatePairs: engineResult.results.filter(
          (result) => result.diagnostics.candidate > 0,
        ).length,
        withEligiblePairs: engineResult.results.filter(
          (result) => result.diagnostics.eligible > 0,
        ).length,
        withSurfacedPairs: engineResult.results.filter(
          (result) => result.diagnostics.surfaced > 0,
        ).length,
      },
      pairFunnel: {
        evaluated: engineResult.evaluatedPairCount,
        returned: allEvaluations.length,
        rejected: rejectedEvaluations.length,
        blocked: allEvaluations.filter(
          (evaluation) => evaluation.pairability.status === 'blocked',
        ).length,
        listedExitOnly: allEvaluations.filter(
          (evaluation) => evaluation.pairability.status === 'listed_exit_only',
        ).length,
        softListedExitOnly: allEvaluations.filter(
          (evaluation) =>
            evaluation.pairability.status === 'listed_exit_only' &&
            evaluation.disposition !== 'rejected',
        ).length,
        pairable: allEvaluations.filter(
          (evaluation) => evaluation.pairability.status === 'pairable',
        ).length,
        buySourceHasNoAsk: rejectedEvaluations.filter((evaluation) =>
          evaluation.reasonCodes.includes('buy_source_has_no_ask'),
        ).length,
        sellSourceHasNoExitSignal: rejectedEvaluations.filter((evaluation) =>
          evaluation.reasonCodes.includes('sell_source_has_no_exit_signal'),
        ).length,
        strictVariantKeyMissing: rejectedEvaluations.filter((evaluation) =>
          evaluation.reasonCodes.includes('strict_variant_key_missing'),
        ).length,
        strictVariantKeyMismatch: rejectedEvaluations.filter((evaluation) =>
          evaluation.reasonCodes.includes('strict_variant_key_mismatch'),
        ).length,
        preScoreRejected: rejectedEvaluations.filter(
          (evaluation) =>
            evaluation.reasonCodes.includes('pre_score_outlier_rejected') ||
            evaluation.reasonCodes.includes('stale_pre_score_rejection'),
        ).length,
        antiFakeRejected: rejectedEvaluations.filter(
          (evaluation) => evaluation.antiFakeAssessment.hardReject,
        ).length,
        nearEqualAfterFees: allEvaluations.filter((evaluation) =>
          evaluation.reasonCodes.includes('near_equal_after_fees'),
        ).length,
        trueNonPositiveEdge: rejectedEvaluations.filter((evaluation) =>
          evaluation.reasonCodes.includes('true_non_positive_edge'),
        ).length,
        negativeExpectedNet: rejectedEvaluations.filter((evaluation) =>
          evaluation.reasonCodes.includes('negative_fees_adjusted_spread'),
        ).length,
        confidenceBelowCandidateFloor: rejectedEvaluations.filter(
          (evaluation) =>
            evaluation.reasonCodes.includes('confidence_below_candidate_floor'),
        ).length,
        otherRejected: rejectedEvaluations.filter(
          (evaluation) =>
            !evaluation.reasonCodes.includes('buy_source_has_no_ask') &&
            !evaluation.reasonCodes.includes('sell_source_has_no_exit_signal') &&
            !evaluation.reasonCodes.includes('strict_variant_key_missing') &&
            !evaluation.reasonCodes.includes('strict_variant_key_mismatch') &&
            !evaluation.reasonCodes.includes('pre_score_outlier_rejected') &&
            !evaluation.reasonCodes.includes('stale_pre_score_rejection') &&
            !evaluation.antiFakeAssessment.hardReject &&
            !evaluation.reasonCodes.includes('negative_fees_adjusted_spread') &&
            !evaluation.reasonCodes.includes(
              'confidence_below_candidate_floor',
            ),
        ).length,
        candidate: engineResult.dispositionSummary.candidate,
        nearEligible: engineResult.dispositionSummary.near_eligible,
        eligible: engineResult.dispositionSummary.eligible,
        riskyHighUpside: engineResult.dispositionSummary.risky_high_upside,
      },
      topRejectReasons: this.collectTopRejectReasons(rejectedEvaluations),
      topBlockerReasons: this.collectTopBlockerReasons(rejectedEvaluations),
    };
  }

  private collectTopRejectReasons(
    rejectedEvaluations: readonly OpportunityEvaluationDto[],
  ): readonly {
    readonly reasonCode: OpportunityReasonCode;
    readonly count: number;
  }[] {
    const counts = new Map<OpportunityReasonCode, number>();

    for (const evaluation of rejectedEvaluations) {
      for (const reasonCode of new Set(evaluation.reasonCodes)) {
        counts.set(reasonCode, (counts.get(reasonCode) ?? 0) + 1);
      }
    }

    return [...counts.entries()]
      .map(([reasonCode, count]) => ({
        reasonCode,
        count,
      }))
      .sort((left, right) => {
        if (right.count !== left.count) {
          return right.count - left.count;
        }

        return left.reasonCode.localeCompare(right.reasonCode);
      })
      .slice(0, OPPORTUNITY_RESCAN_TOP_REASON_LIMIT);
  }

  private collectTopBlockerReasons(
    rejectedEvaluations: readonly OpportunityEvaluationDto[],
  ): readonly {
    readonly blockerReason: OpportunityBlockerReason;
    readonly count: number;
  }[] {
    const counts = new Map<OpportunityBlockerReason, number>();

    for (const evaluation of rejectedEvaluations) {
      if (!evaluation.eligibility.blockerReason) {
        continue;
      }

      counts.set(
        evaluation.eligibility.blockerReason,
        (counts.get(evaluation.eligibility.blockerReason) ?? 0) + 1,
      );
    }

    return [...counts.entries()]
      .map(([blockerReason, count]) => ({
        blockerReason,
        count,
      }))
      .sort((left, right) => {
        if (right.count !== left.count) {
          return right.count - left.count;
        }

        return left.blockerReason.localeCompare(right.blockerReason);
      })
      .slice(0, OPPORTUNITY_RESCAN_TOP_REASON_LIMIT);
  }

  private async materializeEvaluation(
    evaluation: OpportunityEvaluationDto,
    detectedAt: Date,
    sourceIdsByCode: ReadonlyMap<string, string>,
  ): Promise<boolean> {
    if (!evaluation.buy.snapshotId || !evaluation.sell.snapshotId) {
      return false;
    }

    const buySourceId = sourceIdsByCode.get(evaluation.buy.source);
    const sellSourceId = sourceIdsByCode.get(evaluation.sell.source);

    if (!buySourceId || !sellSourceId) {
      return false;
    }

    await this.prismaService.opportunity.upsert({
      where: {
        buySnapshotId_sellSnapshotId: {
          buySnapshotId: evaluation.buy.snapshotId,
          sellSnapshotId: evaluation.sell.snapshotId,
        },
      },
      create: {
        canonicalItemId: evaluation.canonicalItemId,
        itemVariantId: evaluation.itemVariantId,
        buySourceId,
        sellSourceId,
        buySnapshotId: evaluation.buy.snapshotId,
        sellSnapshotId: evaluation.sell.snapshotId,
        status: OpportunityStatus.OPEN,
        riskClass: this.mapRiskClass(evaluation.riskClass),
        spreadAbsolute: this.toDecimal(evaluation.rawSpread),
        spreadPercent: this.toDecimal(evaluation.rawSpreadPercent),
        expectedNet: this.toDecimal(evaluation.expectedNetProfit),
        expectedFees: this.toDecimal(
          Math.max(0, evaluation.rawSpread - evaluation.expectedNetProfit),
        ),
        confidence: this.toDecimal(evaluation.finalConfidence),
        detectedAt,
        expiresAt: new Date(detectedAt.getTime() + MATERIALIZED_OPPORTUNITY_TTL_MS),
        notes: this.buildOpportunityNotes(evaluation),
      },
      update: {
        canonicalItemId: evaluation.canonicalItemId,
        itemVariantId: evaluation.itemVariantId,
        buySourceId,
        sellSourceId,
        status: OpportunityStatus.OPEN,
        riskClass: this.mapRiskClass(evaluation.riskClass),
        spreadAbsolute: this.toDecimal(evaluation.rawSpread),
        spreadPercent: this.toDecimal(evaluation.rawSpreadPercent),
        expectedNet: this.toDecimal(evaluation.expectedNetProfit),
        expectedFees: this.toDecimal(
          Math.max(0, evaluation.rawSpread - evaluation.expectedNetProfit),
        ),
        confidence: this.toDecimal(evaluation.finalConfidence),
        detectedAt,
        expiresAt: new Date(detectedAt.getTime() + MATERIALIZED_OPPORTUNITY_TTL_MS),
        notes: this.buildOpportunityNotes(evaluation),
      },
    });

    return true;
  }

  private buildOpportunityNotes(
    evaluation: OpportunityEvaluationDto,
  ): Prisma.InputJsonValue {
    const notes = {
      sourcePairKey: evaluation.sourcePairKey,
      canonicalDisplayName: evaluation.canonicalDisplayName,
      variantDisplayName: evaluation.variantDisplayName,
      disposition: evaluation.disposition,
      surfaceTier: evaluation.surfaceTier,
      rawSpread: evaluation.rawSpread,
      rawSpreadPercent: evaluation.rawSpreadPercent,
      feesAdjustedSpread: evaluation.feesAdjustedSpread,
      expectedExitPrice: evaluation.expectedExitPrice,
      estimatedSellFeeRate: evaluation.estimatedSellFeeRate,
      buyCost: evaluation.buyCost,
      sellSignalPrice: evaluation.sellSignalPrice,
      reasonCodes: evaluation.reasonCodes,
      riskReasons: evaluation.riskReasons.map((reason) => ({
        code: reason.code,
        severity: reason.severity,
        detail: reason.detail,
      })),
      componentScores: evaluation.componentScores,
      execution: evaluation.execution,
      strictTradable: evaluation.strictTradable,
      preScoreGate: evaluation.preScoreGate,
      eligibility: evaluation.eligibility,
      validation: evaluation.validation,
      pairability: evaluation.pairability,
      rankingInputs: evaluation.rankingInputs,
      penalties: {
        freshnessPenalty: evaluation.penalties.freshnessPenalty,
        liquidityPenalty: evaluation.penalties.liquidityPenalty,
        stalePenalty: evaluation.penalties.stalePenalty,
        categoryPenalty: evaluation.penalties.categoryPenalty,
        sourceDisagreementPenalty:
          evaluation.penalties.sourceDisagreementPenalty,
        backupConfirmationBoost: evaluation.penalties.backupConfirmationBoost,
        totalPenalty: evaluation.penalties.totalPenalty,
      },
      antiFakeAssessment: {
        hardReject: evaluation.antiFakeAssessment.hardReject,
        riskScore: evaluation.antiFakeAssessment.riskScore,
        matchConfidence: evaluation.antiFakeAssessment.matchConfidence,
        premiumContaminationRisk:
          evaluation.antiFakeAssessment.premiumContaminationRisk,
        marketSanityRisk: evaluation.antiFakeAssessment.marketSanityRisk,
        confirmationScore: evaluation.antiFakeAssessment.confirmationScore,
        reasonCodes: evaluation.antiFakeAssessment.reasonCodes,
      },
      buy: {
        source: evaluation.buy.source,
        sourceName: evaluation.buy.sourceName,
        marketUrl: evaluation.buy.marketUrl,
        listingUrl: evaluation.buy.listingUrl,
        observedAt: evaluation.buy.observedAt.toISOString(),
        fetchMode: evaluation.buy.fetchMode,
        confidence: evaluation.buy.confidence,
        ask: evaluation.buy.ask,
        bid: evaluation.buy.bid,
        listedQty: evaluation.buy.listedQty,
        snapshotId: evaluation.buy.snapshotId,
        rawPayloadArchiveId: evaluation.buy.rawPayloadArchiveId,
      },
      sell: {
        source: evaluation.sell.source,
        sourceName: evaluation.sell.sourceName,
        marketUrl: evaluation.sell.marketUrl,
        listingUrl: evaluation.sell.listingUrl,
        observedAt: evaluation.sell.observedAt.toISOString(),
        fetchMode: evaluation.sell.fetchMode,
        confidence: evaluation.sell.confidence,
        ask: evaluation.sell.ask,
        bid: evaluation.sell.bid,
        listedQty: evaluation.sell.listedQty,
        snapshotId: evaluation.sell.snapshotId,
        rawPayloadArchiveId: evaluation.sell.rawPayloadArchiveId,
      },
      ...(evaluation.backupConfirmation
        ? { backupConfirmation: evaluation.backupConfirmation }
        : {}),
      materializedBy: 'admin-opportunities-rescan',
    };

    return JSON.parse(JSON.stringify(notes)) as Prisma.InputJsonValue;
  }

  private mapRiskClass(
    riskClass: OpportunityEvaluationDto['riskClass'],
  ): Prisma.OpportunityUncheckedCreateInput['riskClass'] {
    switch (riskClass) {
      case 'low':
        return 'LOW';
      case 'medium':
        return 'MEDIUM';
      case 'high':
        return 'HIGH';
      case 'extreme':
        return 'EXTREME';
    }
  }

  private toDecimal(value: number): Prisma.Decimal {
    return new Prisma.Decimal(value.toFixed(4));
  }

  private normalizeVariantLimit(value: number | undefined): number | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (!Number.isFinite(value)) {
      return undefined;
    }

    const normalized = Math.trunc(value);

    if (normalized <= 0) {
      return undefined;
    }

    return Math.min(normalized, MAX_BOUNDED_OPPORTUNITY_RESCAN_VARIANTS);
  }
}
