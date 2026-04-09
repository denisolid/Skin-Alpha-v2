import { ItemCategory } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { MarketFreshnessPolicyService } from '../../market-state/services/market-freshness-policy.service';
import type { MarketFreshnessDto } from '../../market-state/dto/market-freshness.dto';
import type { SourceAdapterDescriptor } from '../../source-adapters/domain/source-adapter.interface';
import type { SourceSyncMode } from '../../source-adapters/domain/source-adapter.types';
import { SourceAdapterDirectoryService } from '../../source-adapters/services/source-adapter-directory.service';
import type {
  ScannerUniverseCandidateRecord,
  ScannerUniverseMarketStateRecord,
} from '../domain/opportunities.repository';
import {
  SCANNER_CATEGORY_POLICIES,
  SCANNER_SOURCE_POLL_INTERVAL_SECONDS,
} from '../domain/scanner-universe-policy.model';
import {
  clampUniverseScore,
  demoteScannerItemTier,
  promoteScannerItemTier,
  type ScannerItemTier,
} from '../domain/item-tier.model';
import type {
  ScannerUniverseItemDto,
  ScannerUniverseManualOverrideDto,
  ScannerUniversePollingSourcePlanDto,
} from '../dto/scanner-universe.dto';

interface EvaluatedMarketState {
  readonly state: ScannerUniverseMarketStateRecord;
  readonly freshness: MarketFreshnessDto;
  readonly isBackup: boolean;
}

@Injectable()
export class ScannerUniversePolicyService {
  constructor(
    @Inject(SourceAdapterDirectoryService)
    private readonly sourceAdapterDirectoryService: SourceAdapterDirectoryService,
    @Inject(MarketFreshnessPolicyService)
    private readonly marketFreshnessPolicyService: MarketFreshnessPolicyService,
  ) {}

  evaluateCandidate(
    candidate: ScannerUniverseCandidateRecord,
    generatedAt: Date,
    manualOverride?: ScannerUniverseManualOverrideDto,
  ): ScannerUniverseItemDto {
    const categoryPolicy = SCANNER_CATEGORY_POLICIES[candidate.category];
    const evaluatedStates = candidate.marketStates.map((state) =>
      this.evaluateMarketState(state, generatedAt),
    );
    const usablePrimaryStates = evaluatedStates.filter(
      (state) => !state.isBackup && state.freshness.usable,
    );
    const freshPrimaryStates = evaluatedStates.filter(
      (state) => !state.isBackup && state.freshness.state === 'fresh',
    );
    const backupStates = evaluatedStates.filter((state) => state.isBackup);
    const priceMovementRatio = this.derivePriceMovementRatio(
      evaluatedStates,
      candidate.category,
    );
    const pairabilityMetrics = this.derivePairabilityMetrics(
      usablePrimaryStates.length,
      freshPrimaryStates.length,
    );
    const signals = {
      liquidity: this.deriveLiquidityScore(evaluatedStates, candidate.category),
      priceMovement: clampUniverseScore(
        priceMovementRatio / categoryPolicy.priceMovementReferencePercent,
      ),
      sourceActivity: this.deriveSourceActivityScore(
        usablePrimaryStates.length,
        freshPrimaryStates.length,
        categoryPolicy.sourceActivityTargetSources,
      ),
      pairability: this.derivePairabilityScore(
        pairabilityMetrics.currentReadyPairCount,
        pairabilityMetrics.usablePrimarySourceCount,
        pairabilityMetrics.freshPrimarySourceCount,
      ),
      composite: 0,
    };
    const compositeScore = clampUniverseScore(
      signals.liquidity * categoryPolicy.weights.liquidity +
        signals.priceMovement * categoryPolicy.weights.priceMovement +
        signals.sourceActivity * categoryPolicy.weights.sourceActivity +
        signals.pairability * categoryPolicy.weights.pairability,
    );
    signals.composite = compositeScore;
    let tier = this.resolveScoreTier(candidate.category, compositeScore);
    const promotionReasons: string[] = [];
    const demotionReasons: string[] = [];

    if (manualOverride) {
      tier = 'hot';
      promotionReasons.push('manual_hot_override');
    } else {
      if (
        pairabilityMetrics.currentReadyPairCount >= 1 &&
        usablePrimaryStates.length >= 2 &&
        tier !== 'hot'
      ) {
        tier = promoteScannerItemTier(tier);
        promotionReasons.push('current_multi_source_readiness');
      }

      if (
        signals.priceMovement >= 0.9 &&
        signals.liquidity >= 0.45 &&
        tier !== 'hot'
      ) {
        tier = promoteScannerItemTier(tier);
        promotionReasons.push('elevated_price_movement_on_liquid_item');
      }

      if (signals.sourceActivity < 0.2) {
        tier = demoteScannerItemTier(tier);
        demotionReasons.push('low_fresh_source_activity');
      }

      if (
        signals.liquidity < 0.12 &&
        pairabilityMetrics.currentReadyPairCount === 0
      ) {
        tier = demoteScannerItemTier(tier);
        demotionReasons.push('thin_liquidity_without_pairable_coverage');
      }

      if (usablePrimaryStates.length === 0 && backupStates.length > 0) {
        tier = 'cold';
        demotionReasons.push('backup_only_coverage');
      }
    }

    return {
      canonicalItemId: candidate.canonicalItemId,
      canonicalDisplayName: candidate.canonicalDisplayName,
      itemVariantId: candidate.itemVariantId,
      variantDisplayName: candidate.variantDisplayName,
      category: candidate.category,
      itemType: candidate.itemType,
      tier,
      compositeScore,
      signals,
      pairabilityMetrics,
      sourceMetrics: {
        totalSourceCount: evaluatedStates.length,
        usableSourceCount: usablePrimaryStates.length,
        freshSourceCount: freshPrimaryStates.length,
        backupSourceCount: backupStates.length,
      },
      pollingPlan: this.buildPollingPlan(
        candidate.category,
        tier,
        evaluatedStates,
        Boolean(manualOverride),
      ),
      promotionReasons,
      demotionReasons,
      ...(manualOverride ? { manualOverride } : {}),
    };
  }

  private evaluateMarketState(
    state: ScannerUniverseMarketStateRecord,
    generatedAt: Date,
  ): EvaluatedMarketState {
    const freshness = this.marketFreshnessPolicyService.evaluateSourceState(
      state,
      state.observedAt,
      generatedAt,
    );
    const fetchMode = this.marketFreshnessPolicyService.resolveFetchMode(
      state,
      freshness,
      false,
    );

    return {
      state,
      freshness,
      isBackup: fetchMode === 'backup',
    };
  }

  private deriveLiquidityScore(
    evaluatedStates: readonly EvaluatedMarketState[],
    category: ItemCategory,
  ): number {
    const categoryPolicy = SCANNER_CATEGORY_POLICIES[category];
    const stateScores = evaluatedStates
      .filter((state) => state.freshness.usable)
      .map((state) => {
        const explicitLiquidity = this.toNumber(state.state.liquidityScore);
        const listingDepthSignal = clampUniverseScore(
          (state.state.listingCount ?? 0) /
            categoryPolicy.liquidityListingDepthDivisor,
        );
        const confidence = this.toNumber(state.state.confidence) ?? 0.5;
        const rawScore = explicitLiquidity ?? listingDepthSignal;
        const backupMultiplier = state.isBackup ? 0.75 : 1;

        return clampUniverseScore(
          rawScore * (0.7 + confidence * 0.3) * backupMultiplier,
        );
      });

    if (stateScores.length === 0) {
      return 0;
    }

    const topScore = Math.max(...stateScores);
    const breadthBonus = clampUniverseScore((stateScores.length - 1) * 0.08);

    return clampUniverseScore(topScore + breadthBonus);
  }

  private derivePriceMovementRatio(
    evaluatedStates: readonly EvaluatedMarketState[],
    category: ItemCategory,
  ): number {
    const categoryPolicy = SCANNER_CATEGORY_POLICIES[category];

    return evaluatedStates.reduce((highestMovement, state) => {
      if (!state.freshness.usable) {
        return highestMovement;
      }

      const ask = this.toNumber(state.state.lowestAskGross);
      const reference =
        this.toNumber(state.state.average24hGross) ??
        this.toNumber(state.state.lastTradeGross);

      if (
        ask === undefined ||
        reference === undefined ||
        reference <= Number.EPSILON
      ) {
        return highestMovement;
      }

      const rawMovement = Math.abs(ask - reference) / reference;
      const confidence = this.toNumber(state.state.confidence) ?? 0.5;
      const adjustedMovement =
        rawMovement * (state.isBackup ? 0.7 : 1) * (0.7 + confidence * 0.3);

      return Math.max(
        highestMovement,
        Math.min(
          adjustedMovement,
          categoryPolicy.priceMovementReferencePercent,
        ),
      );
    }, 0);
  }

  private deriveSourceActivityScore(
    usablePrimarySourceCount: number,
    freshPrimarySourceCount: number,
    sourceActivityTargetSources: number,
  ): number {
    if (sourceActivityTargetSources <= 0) {
      return 0;
    }

    const usableComponent = clampUniverseScore(
      usablePrimarySourceCount / sourceActivityTargetSources,
    );
    const freshComponent = clampUniverseScore(
      freshPrimarySourceCount / sourceActivityTargetSources,
    );

    return clampUniverseScore(freshComponent * 0.7 + usableComponent * 0.3);
  }

  private derivePairabilityScore(
    currentReadyPairCount: number,
    usablePrimarySourceCount: number,
    freshPrimarySourceCount: number,
  ): number {
    const readyPairComponent = clampUniverseScore(currentReadyPairCount / 3);
    const usableSourceComponent = clampUniverseScore(
      usablePrimarySourceCount / 2,
    );
    const freshSourceComponent = clampUniverseScore(
      freshPrimarySourceCount / 2,
    );

    return clampUniverseScore(
      readyPairComponent * 0.5 +
        usableSourceComponent * 0.3 +
        freshSourceComponent * 0.2,
    );
  }

  private derivePairabilityMetrics(
    usablePrimarySourceCount: number,
    freshPrimarySourceCount: number,
  ) {
    const currentReadyPairCount =
      usablePrimarySourceCount >= 2
        ? Math.floor((usablePrimarySourceCount * (usablePrimarySourceCount - 1)) / 2)
        : 0;

    return {
      currentReadyPairCount,
      usablePrimarySourceCount,
      freshPrimarySourceCount,
    };
  }

  private buildPollingPlan(
    category: ItemCategory,
    tier: ScannerItemTier,
    evaluatedStates: readonly EvaluatedMarketState[],
    manualHotOverride: boolean,
  ): readonly ScannerUniversePollingSourcePlanDto[] {
    const categoryPolicy = SCANNER_CATEGORY_POLICIES[category];
    const stateBySource = new Map(
      evaluatedStates.map((state) => [state.state.sourceCode, state] as const),
    );

    return this.sourceAdapterDirectoryService
      .listDescriptors()
      .filter((adapter) => adapter.priority.enabled)
      .map((adapter) => {
        const currentState = stateBySource.get(adapter.key);
        const intervalMultiplier =
          categoryPolicy.pollIntervalMultiplier[adapter.key] ?? 1;
        const pollIntervalSeconds = Math.max(
          30,
          Math.round(
            SCANNER_SOURCE_POLL_INTERVAL_SECONDS[adapter.key][tier] *
              intervalMultiplier,
          ),
        );
        const coverageBonus = !currentState
          ? 8
          : currentState.freshness.state === 'fresh'
            ? 3
            : currentState.freshness.usable
              ? 5
              : 7;
        const priorityWeight =
          adapter.priority.weight +
          (categoryPolicy.sourceBias[adapter.key] ?? 0) +
          coverageBonus +
          (manualHotOverride && tier === 'hot' ? 6 : 0);

        return {
          source: adapter.key,
          sourceName: adapter.displayName,
          syncMode: this.selectSyncMode(adapter, tier),
          pollIntervalSeconds,
          priorityWeight,
          reason: this.buildPollingReason(
            adapter,
            tier,
            category,
            currentState?.freshness.state,
            manualHotOverride,
          ),
        };
      })
      .sort((left, right) => {
        if (right.priorityWeight !== left.priorityWeight) {
          return right.priorityWeight - left.priorityWeight;
        }

        return left.sourceName.localeCompare(right.sourceName);
      });
  }

  private buildPollingReason(
    adapter: SourceAdapterDescriptor,
    tier: ScannerItemTier,
    category: ItemCategory,
    freshnessState: MarketFreshnessDto['state'] | undefined,
    manualHotOverride: boolean,
  ): string {
    const reasonParts = [
      `${tier}_tier`,
      category.toLowerCase(),
      adapter.priority.tier,
    ];

    if (freshnessState) {
      reasonParts.push(`${freshnessState}_coverage`);
    } else {
      reasonParts.push('missing_coverage');
    }

    if (manualHotOverride) {
      reasonParts.push('manual_override');
    }

    return reasonParts.join(':');
  }

  private resolveScoreTier(
    category: ItemCategory,
    compositeScore: number,
  ): ScannerItemTier {
    const categoryPolicy = SCANNER_CATEGORY_POLICIES[category];

    if (compositeScore >= categoryPolicy.hotThreshold) {
      return 'hot';
    }

    if (compositeScore >= categoryPolicy.warmThreshold) {
      return 'warm';
    }

    return 'cold';
  }

  private selectSyncMode(
    adapter: SourceAdapterDescriptor,
    tier: ScannerItemTier,
  ): SourceSyncMode {
    const { supportedSyncModes } = adapter.capabilities;

    if (tier === 'hot' && supportedSyncModes.includes('incremental')) {
      return 'incremental';
    }

    if (tier !== 'hot' && supportedSyncModes.includes('market-state-only')) {
      return 'market-state-only';
    }

    if (supportedSyncModes.includes('full-snapshot')) {
      return 'full-snapshot';
    }

    return supportedSyncModes[0] ?? 'market-state-only';
  }

  private toNumber(
    value: { toString(): string } | null | undefined,
  ): number | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }

    const numericValue = Number(value.toString());

    return Number.isFinite(numericValue) ? numericValue : undefined;
  }
}
