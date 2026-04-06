import { Injectable } from '@nestjs/common';
import { ItemCategory } from '@prisma/client';

import type {
  MergedMarketMatrixDto,
  MergedMarketMatrixRowDto,
} from '../../market-state/dto/merged-market-matrix.dto';
import type {
  AntiFakeAssessment,
  OpportunityAntiFakeCounters,
} from '../domain/anti-fake.model';
import type { OpportunityReasonCode } from '../domain/opportunity-engine.model';

interface OpportunityAntiFakeInput {
  readonly matrix: MergedMarketMatrixDto;
  readonly buyRow: MergedMarketMatrixRowDto;
  readonly sellRow: MergedMarketMatrixRowDto;
  readonly backupRows: readonly MergedMarketMatrixRowDto[];
  readonly buyCost: number;
  readonly sellSignalPrice: number;
}

const MISMATCH_REASON_CODES = [
  'MISMATCH_EXTERIOR',
  'MISMATCH_STATTRAK',
  'MISMATCH_SOUVENIR',
  'MISMATCH_PHASE',
  'LOW_MATCH_CONFIDENCE',
] as const satisfies readonly OpportunityReasonCode[];

const PREMIUM_REASON_CODES = [
  'UNKNOWN_FLOAT_PREMIUM',
  'UNKNOWN_STICKER_PREMIUM',
  'UNKNOWN_PATTERN_PREMIUM',
  'UNKNOWN_PHASE_PREMIUM',
] as const satisfies readonly OpportunityReasonCode[];

const STALE_REASON_CODES = [
  'STALE_SOURCE_STATE',
] as const satisfies readonly OpportunityReasonCode[];

const LOW_CONFIDENCE_REASON_CODES = [
  'LOW_SOURCE_CONFIDENCE',
] as const satisfies readonly OpportunityReasonCode[];

const LIQUIDITY_REASON_CODES = [
  'INSUFFICIENT_LIQUIDITY',
  'FROZEN_MARKET',
] as const satisfies readonly OpportunityReasonCode[];

const OUTLIER_REASON_CODES = [
  'OUTLIER_PRICE',
] as const satisfies readonly OpportunityReasonCode[];

@Injectable()
export class OpportunityAntiFakeService {
  assess(input: OpportunityAntiFakeInput): AntiFakeAssessment {
    const reasonCodes = new Set<OpportunityReasonCode>();
    const rows = [input.buyRow, input.sellRow] as const;
    let hardReject = false;

    const matchConfidence = this.computeMatchConfidence(input, reasonCodes);

    hardReject ||= this.applyHardMismatchChecks(input, reasonCodes);

    if (matchConfidence < 0.58) {
      reasonCodes.add('LOW_MATCH_CONFIDENCE');
    }

    if (matchConfidence < 0.24) {
      hardReject = true;
    }

    const premiumContaminationRisk = this.computePremiumRisk(
      input,
      reasonCodes,
    );
    const confirmationScore = this.computeConfirmationScore(input, reasonCodes);
    let marketSanityRisk = this.computeMarketSanityRisk(input, reasonCodes);

    if (confirmationScore === 0) {
      marketSanityRisk = this.clampRatio(
        marketSanityRisk +
          this.getCategoryWeight(input.matrix.category, {
            light: 0.015,
            defaultValue: 0.03,
            heavy: 0.045,
          }),
      );
    }

    if (rows.some((row) => !row.freshness.usable)) {
      reasonCodes.add('STALE_SOURCE_STATE');
      hardReject = true;
    }

    if (
      this.isExtremeOutlier(input, confirmationScore) ||
      this.isHardFrozenMarket(input)
    ) {
      hardReject = true;
    }

    const riskScore = this.clampRatio(
      (1 - matchConfidence) * 0.4 +
        premiumContaminationRisk * 0.3 +
        marketSanityRisk * 0.35 -
        confirmationScore * 0.2,
    );

    return {
      hardReject,
      riskScore,
      matchConfidence,
      premiumContaminationRisk,
      marketSanityRisk,
      confirmationScore,
      reasonCodes: [...reasonCodes],
    };
  }

  createCounters(
    evaluations: readonly {
      readonly disposition: string;
      readonly reasonCodes: readonly OpportunityReasonCode[];
      readonly antiFakeAssessment: AntiFakeAssessment;
    }[],
  ): OpportunityAntiFakeCounters {
    return evaluations.reduce<OpportunityAntiFakeCounters>(
      (counters, evaluation) => {
        const reasonCodes = new Set(evaluation.reasonCodes);
        const rejected = evaluation.disposition === 'rejected';

        return {
          rejectedByMismatch:
            counters.rejectedByMismatch +
            (rejected && this.hasAnyReason(reasonCodes, MISMATCH_REASON_CODES)
              ? 1
              : 0),
          rejectedByPremiumContamination:
            counters.rejectedByPremiumContamination +
            (rejected && this.hasAnyReason(reasonCodes, PREMIUM_REASON_CODES)
              ? 1
              : 0),
          rejectedByStaleState:
            counters.rejectedByStaleState +
            (rejected && this.hasAnyReason(reasonCodes, STALE_REASON_CODES)
              ? 1
              : 0),
          rejectedByLowConfidence:
            counters.rejectedByLowConfidence +
            (rejected &&
            this.hasAnyReason(reasonCodes, LOW_CONFIDENCE_REASON_CODES)
              ? 1
              : 0),
          rejectedByLiquidity:
            counters.rejectedByLiquidity +
            (rejected && this.hasAnyReason(reasonCodes, LIQUIDITY_REASON_CODES)
              ? 1
              : 0),
          rejectedByOutlier:
            counters.rejectedByOutlier +
            (rejected && this.hasAnyReason(reasonCodes, OUTLIER_REASON_CODES)
              ? 1
              : 0),
          downgradedToRiskyHighUpside:
            counters.downgradedToRiskyHighUpside +
            (evaluation.disposition === 'risky_high_upside' &&
            evaluation.antiFakeAssessment.riskScore >= 0.38
              ? 1
              : 0),
        };
      },
      {
        rejectedByMismatch: 0,
        rejectedByPremiumContamination: 0,
        rejectedByStaleState: 0,
        rejectedByLowConfidence: 0,
        rejectedByLiquidity: 0,
        rejectedByOutlier: 0,
        downgradedToRiskyHighUpside: 0,
      },
    );
  }

  private applyHardMismatchChecks(
    input: OpportunityAntiFakeInput,
    reasonCodes: Set<OpportunityReasonCode>,
  ): boolean {
    const expectedExterior = this.normalizeText(
      input.matrix.variantIdentity.exterior,
    );
    const expectedPhase = this.normalizePhase(
      input.matrix.variantIdentity.phaseLabel,
    );

    for (const row of [input.buyRow, input.sellRow]) {
      const rowExterior = this.resolveExterior(row);

      if (
        input.matrix.category === ItemCategory.SKIN &&
        expectedExterior &&
        rowExterior &&
        rowExterior !== expectedExterior
      ) {
        reasonCodes.add('MISMATCH_EXTERIOR');
        return true;
      }

      const rowStatTrak = row.identity?.isStatTrak;

      if (
        rowStatTrak !== undefined &&
        rowStatTrak !== input.matrix.variantIdentity.stattrak
      ) {
        reasonCodes.add('MISMATCH_STATTRAK');
        return true;
      }

      const rowSouvenir = row.identity?.isSouvenir;

      if (
        rowSouvenir !== undefined &&
        rowSouvenir !== input.matrix.variantIdentity.souvenir
      ) {
        reasonCodes.add('MISMATCH_SOUVENIR');
        return true;
      }

      if (
        (input.matrix.category === ItemCategory.KNIFE ||
          input.matrix.category === ItemCategory.GLOVE) &&
        this.hasPhaseMismatch(
          row,
          input.matrix.variantIdentity.isVanilla,
          expectedPhase,
        )
      ) {
        reasonCodes.add('MISMATCH_PHASE');
        return true;
      }
    }

    return false;
  }

  private computeMatchConfidence(
    input: OpportunityAntiFakeInput,
    reasonCodes: Set<OpportunityReasonCode>,
  ): number {
    const expectedTitle =
      input.matrix.variantIdentity.marketHashName ??
      input.matrix.variantDisplayName;
    const expectedExterior = this.normalizeText(
      input.matrix.variantIdentity.exterior,
    );
    const expectedPhase = this.normalizePhase(
      input.matrix.variantIdentity.phaseLabel,
    );
    let confidence = Math.max(
      0.32,
      input.matrix.variantIdentity.mappingConfidence,
    );

    for (const row of [input.buyRow, input.sellRow]) {
      if (
        row.identity?.title &&
        this.isTitleAligned(row.identity.title, expectedTitle)
      ) {
        confidence += 0.08;
      }

      if (expectedExterior) {
        const rowExterior = this.resolveExterior(row);

        confidence += rowExterior === expectedExterior ? 0.04 : -0.05;
      }

      if (expectedPhase) {
        const rowPhase = this.resolvePhase(row);

        confidence +=
          rowPhase === expectedPhase ? 0.05 : rowPhase ? -0.08 : -0.04;
      }

      const statTrakSignal = row.identity?.isStatTrak;
      const souvenirSignal = row.identity?.isSouvenir;

      if (statTrakSignal === input.matrix.variantIdentity.stattrak) {
        confidence += 0.03;
      } else if (statTrakSignal !== undefined) {
        confidence -= 0.1;
      }

      if (souvenirSignal === input.matrix.variantIdentity.souvenir) {
        confidence += 0.03;
      } else if (souvenirSignal !== undefined) {
        confidence -= 0.1;
      }
    }

    const normalizedConfidence = this.clampRatio(confidence);

    if (normalizedConfidence < 0.58) {
      reasonCodes.add('LOW_MATCH_CONFIDENCE');
    }

    return normalizedConfidence;
  }

  private computePremiumRisk(
    input: OpportunityAntiFakeInput,
    reasonCodes: Set<OpportunityReasonCode>,
  ): number {
    if (
      input.matrix.category === ItemCategory.CASE ||
      input.matrix.category === ItemCategory.CAPSULE
    ) {
      return 0;
    }

    const buyIdentity = input.buyRow.identity;
    const sellIdentity = input.sellRow.identity;
    let risk = 0;

    if (
      input.matrix.variantIdentity.floatRelevant &&
      Boolean(buyIdentity?.wearFloat !== undefined) !==
        Boolean(sellIdentity?.wearFloat !== undefined)
    ) {
      reasonCodes.add('UNKNOWN_FLOAT_PREMIUM');
      risk += this.getCategoryWeight(input.matrix.category, {
        light: 0.02,
        defaultValue: 0.1,
        heavy: 0.07,
      });
    }

    if (
      input.matrix.variantIdentity.patternRelevant &&
      Boolean(buyIdentity?.paintSeed !== undefined) !==
        Boolean(sellIdentity?.paintSeed !== undefined)
    ) {
      reasonCodes.add('UNKNOWN_PATTERN_PREMIUM');
      risk += this.getCategoryWeight(input.matrix.category, {
        light: 0.03,
        defaultValue: 0.09,
        heavy: 0.12,
      });
    }

    const buyStickerCount = buyIdentity?.stickerCount ?? 0;
    const sellStickerCount = sellIdentity?.stickerCount ?? 0;

    if (
      buyStickerCount !== sellStickerCount &&
      Math.max(buyStickerCount, sellStickerCount) > 0
    ) {
      reasonCodes.add('UNKNOWN_STICKER_PREMIUM');
      risk += this.getCategoryWeight(input.matrix.category, {
        light: 0.03,
        defaultValue: 0.08,
        heavy: 0.06,
      });
    }

    if (
      (input.matrix.category === ItemCategory.KNIFE ||
        input.matrix.category === ItemCategory.GLOVE) &&
      !input.matrix.variantIdentity.isVanilla &&
      Boolean(this.resolvePhase(input.buyRow)) !==
        Boolean(this.resolvePhase(input.sellRow))
    ) {
      reasonCodes.add('UNKNOWN_PHASE_PREMIUM');
      risk += 0.12;
    }

    return this.clampRatio(risk);
  }

  private computeMarketSanityRisk(
    input: OpportunityAntiFakeInput,
    reasonCodes: Set<OpportunityReasonCode>,
  ): number {
    const staleWeight = this.getCategoryWeight(input.matrix.category, {
      light: 0.08,
      defaultValue: 0.12,
      heavy: 0.18,
    });
    const liquidityWeight = this.getCategoryWeight(input.matrix.category, {
      light: 0.06,
      defaultValue: 0.1,
      heavy: 0.16,
    });
    const outlierWeight = this.getCategoryWeight(input.matrix.category, {
      light: 0.08,
      defaultValue: 0.1,
      heavy: 0.14,
    });
    let risk = 0;

    if (
      input.buyRow.freshness.state !== 'fresh' ||
      input.sellRow.freshness.state !== 'fresh' ||
      input.buyRow.fetchMode === 'fallback' ||
      input.sellRow.fetchMode === 'fallback'
    ) {
      reasonCodes.add('STALE_SOURCE_STATE');
      risk += staleWeight;
      if (
        input.buyRow.fetchMode === 'fallback' ||
        input.sellRow.fetchMode === 'fallback'
      ) {
        risk += staleWeight * 0.5;
      }
    }

    const weakestConfidence = Math.min(
      input.buyRow.confidence,
      input.sellRow.confidence,
      input.buyRow.sourceConfidence,
      input.sellRow.sourceConfidence,
    );

    if (weakestConfidence < 0.42) {
      reasonCodes.add('LOW_SOURCE_CONFIDENCE');
      risk += weakestConfidence < 0.2 ? 0.2 : 0.1;
    }

    const minDepth = Math.min(
      input.buyRow.listedQty ?? 0,
      input.sellRow.listedQty ?? 0,
    );
    const targetDepth = this.resolveLiquidityTarget(input.matrix.category);

    if (minDepth < targetDepth) {
      reasonCodes.add('INSUFFICIENT_LIQUIDITY');
      risk += liquidityWeight * (1 - minDepth / Math.max(1, targetDepth));
    }

    if (
      input.sellRow.bid === undefined &&
      (input.sellRow.listedQty ?? 0) <= 1 &&
      (input.sellRow.freshness.state !== 'fresh' ||
        input.sellRow.fetchMode === 'fallback')
    ) {
      reasonCodes.add('FROZEN_MARKET');
      risk += liquidityWeight + 0.06;
    }

    if (this.isSoftOutlier(input)) {
      reasonCodes.add('OUTLIER_PRICE');
      risk += outlierWeight;
    }

    return this.clampRatio(risk);
  }

  private computeConfirmationScore(
    input: OpportunityAntiFakeInput,
    reasonCodes: Set<OpportunityReasonCode>,
  ): number {
    const tradableSupport = input.matrix.rows.filter(
      (row) =>
        row.source !== input.buyRow.source &&
        row.source !== input.sellRow.source &&
        row.fetchMode !== 'backup',
    );
    const confirmingTradableRows = tradableSupport.filter((row) =>
      this.isConfirmingRow(row, input.buyCost, input.sellSignalPrice),
    );
    const confirmingBackupRows = input.backupRows.filter((row) =>
      this.isConfirmingRow(row, input.buyCost, input.sellSignalPrice),
    );
    const score = this.clampRatio(
      confirmingTradableRows.length * 0.16 + confirmingBackupRows.length * 0.12,
    );

    if (score === 0) {
      reasonCodes.add('NO_CONFIRMING_SOURCE');
    }

    return score;
  }

  private isSoftOutlier(input: OpportunityAntiFakeInput): boolean {
    const pairMultiple =
      input.sellSignalPrice / Math.max(0.0001, input.buyCost);
    const maxDeviation = Math.max(
      Math.abs(input.buyRow.deviationFromConsensusPercent ?? 0),
      Math.abs(input.sellRow.deviationFromConsensusPercent ?? 0),
    );
    const threshold = this.getCategoryWeight(input.matrix.category, {
      light: 1.65,
      defaultValue: 2.05,
      heavy: 1.75,
    });

    return pairMultiple >= threshold || maxDeviation >= 28;
  }

  private isExtremeOutlier(
    input: OpportunityAntiFakeInput,
    confirmationScore: number,
  ): boolean {
    const pairMultiple =
      input.sellSignalPrice / Math.max(0.0001, input.buyCost);
    const hardThreshold = this.getCategoryWeight(input.matrix.category, {
      light: 2.1,
      defaultValue: 2.8,
      heavy: 2.2,
    });
    const maxDeviation = Math.max(
      Math.abs(input.buyRow.deviationFromConsensusPercent ?? 0),
      Math.abs(input.sellRow.deviationFromConsensusPercent ?? 0),
    );

    return (
      confirmationScore < 0.08 &&
      (pairMultiple >= hardThreshold || maxDeviation >= 40)
    );
  }

  private isHardFrozenMarket(input: OpportunityAntiFakeInput): boolean {
    if (
      input.matrix.category !== ItemCategory.KNIFE &&
      input.matrix.category !== ItemCategory.GLOVE
    ) {
      return false;
    }

    return (
      input.sellRow.bid === undefined &&
      (input.sellRow.listedQty ?? 0) <= 1 &&
      (input.sellRow.fetchMode === 'fallback' ||
        input.sellRow.freshness.state !== 'fresh')
    );
  }

  private isConfirmingRow(
    row: MergedMarketMatrixRowDto,
    buyCost: number,
    sellSignalPrice: number,
  ): boolean {
    const referencePrice = row.ask ?? row.bid;

    if (referencePrice === undefined) {
      return false;
    }

    const midpoint = (buyCost + sellSignalPrice) / 2;

    return (
      referencePrice >= buyCost * 0.97 &&
      referencePrice <= sellSignalPrice * 1.03 &&
      Math.abs(referencePrice - midpoint) / Math.max(0.0001, midpoint) <= 0.1
    );
  }

  private hasPhaseMismatch(
    row: MergedMarketMatrixRowDto,
    isVanilla: boolean,
    expectedPhase?: string,
  ): boolean {
    const rowPhase = this.resolvePhase(row);

    if (isVanilla && rowPhase) {
      return true;
    }

    return Boolean(expectedPhase && rowPhase && rowPhase !== expectedPhase);
  }

  private resolveExterior(row: MergedMarketMatrixRowDto): string | undefined {
    const explicitExterior = this.normalizeText(row.identity?.condition);

    if (explicitExterior) {
      return explicitExterior;
    }

    const title = row.identity?.title;

    if (!title) {
      return undefined;
    }

    const exteriorMatch = title.match(/\(([^)]+)\)$/u);

    return this.normalizeText(exteriorMatch?.[1]);
  }

  private resolvePhase(row: MergedMarketMatrixRowDto): string | undefined {
    const explicitPhase = this.normalizePhase(row.identity?.phase);

    if (explicitPhase) {
      return explicitPhase;
    }

    return this.extractPhaseFromText(row.identity?.title);
  }

  private extractPhaseFromText(value?: string): string | undefined {
    const normalizedValue = this.normalizeText(value);

    if (!normalizedValue) {
      return undefined;
    }

    for (const phase of [
      'phase 1',
      'phase 2',
      'phase 3',
      'phase 4',
      'ruby',
      'sapphire',
      'black pearl',
      'emerald',
    ] as const) {
      if (normalizedValue.includes(phase)) {
        return phase;
      }
    }

    return undefined;
  }

  private isTitleAligned(title: string, expectedTitle: string): boolean {
    const normalizedTitle = this.normalizeText(title);
    const normalizedExpectedTitle = this.normalizeText(expectedTitle);

    if (!normalizedTitle || !normalizedExpectedTitle) {
      return false;
    }

    return (
      normalizedTitle.includes(normalizedExpectedTitle) ||
      normalizedExpectedTitle.includes(normalizedTitle)
    );
  }

  private normalizePhase(value?: string): string | undefined {
    return this.normalizeText(value);
  }

  private normalizeText(value?: string): string | undefined {
    return value ? value.trim().toLowerCase().replace(/\s+/gu, ' ') : undefined;
  }

  private resolveLiquidityTarget(category: ItemCategory): number {
    switch (category) {
      case ItemCategory.CASE:
      case ItemCategory.CAPSULE:
        return 6;
      case ItemCategory.KNIFE:
      case ItemCategory.GLOVE:
        return 2;
      case ItemCategory.SKIN:
      default:
        return 3;
    }
  }

  private getCategoryWeight(
    category: ItemCategory,
    weights: {
      readonly light: number;
      readonly defaultValue: number;
      readonly heavy: number;
    },
  ): number {
    if (category === ItemCategory.CASE || category === ItemCategory.CAPSULE) {
      return weights.light;
    }

    if (category === ItemCategory.KNIFE || category === ItemCategory.GLOVE) {
      return weights.heavy;
    }

    return weights.defaultValue;
  }

  private hasAnyReason(
    reasonCodes: ReadonlySet<OpportunityReasonCode>,
    targetCodes: readonly OpportunityReasonCode[],
  ): boolean {
    return targetCodes.some((reasonCode) => reasonCodes.has(reasonCode));
  }

  private clampRatio(value: number): number {
    return Number(Math.max(0, Math.min(1, value)).toFixed(4));
  }
}
