import { OpportunityStatus, Prisma } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { OpportunityEvaluationDto } from '../dto/opportunity-engine.dto';
import type { OpportunityRescanResultDto } from '../dto/opportunity-rescan-result.dto';
import { OpportunityEngineService } from './opportunity-engine.service';

const OPPORTUNITY_RESCAN_MAX_PAIRS = 64;

@Injectable()
export class OpportunityRescanService {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(OpportunityEngineService)
    private readonly opportunityEngineService: OpportunityEngineService,
  ) {}

  async rescanAndPersist(): Promise<OpportunityRescanResultDto> {
    const generatedAt = new Date();
    const itemVariants = await this.prismaService.itemVariant.findMany({
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
    });
    const variantResults = await Promise.all(
      itemVariants.map((itemVariant) =>
        this.opportunityEngineService.evaluateVariant(itemVariant.id, {
          includeRejected: false,
          maxPairs: OPPORTUNITY_RESCAN_MAX_PAIRS,
        }),
      ),
    );
    const materializableEvaluations = variantResults.flatMap(
      (result) => result.evaluations,
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
      evaluatedPairCount: variantResults.reduce(
        (total, result) => total + result.evaluatedPairCount,
        0,
      ),
      openOpportunityCount: materializableEvaluations.length,
      persistedOpportunityCount,
      expiredOpportunityCount: expiredResult.count,
      skippedMissingSnapshotCount,
    };
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
        expiresAt: null,
        notes: this.buildOpportunityNotes(evaluation),
      },
    });

    return true;
  }

  private buildOpportunityNotes(
    evaluation: OpportunityEvaluationDto,
  ): Prisma.InputJsonValue {
    return {
      sourcePairKey: evaluation.sourcePairKey,
      disposition: evaluation.disposition,
      reasonCodes: evaluation.reasonCodes,
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
        observedAt: evaluation.buy.observedAt.toISOString(),
        fetchMode: evaluation.buy.fetchMode,
        confidence: evaluation.buy.confidence,
        ask: evaluation.buy.ask,
        bid: evaluation.buy.bid,
        listedQty: evaluation.buy.listedQty,
        rawPayloadArchiveId: evaluation.buy.rawPayloadArchiveId,
      },
      sell: {
        source: evaluation.sell.source,
        sourceName: evaluation.sell.sourceName,
        observedAt: evaluation.sell.observedAt.toISOString(),
        fetchMode: evaluation.sell.fetchMode,
        confidence: evaluation.sell.confidence,
        ask: evaluation.sell.ask,
        bid: evaluation.sell.bid,
        listedQty: evaluation.sell.listedQty,
        rawPayloadArchiveId: evaluation.sell.rawPayloadArchiveId,
      },
      ...(evaluation.backupConfirmation
        ? { backupConfirmation: evaluation.backupConfirmation }
        : {}),
      materializedBy: 'admin-opportunities-rescan',
    };
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
}
