import { SourceKind } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../infrastructure/config/app-config.service';
import type {
  MarketStateSourceRecord,
  MarketSnapshotRecord,
} from '../domain/market-read.repository';
import type { MarketFreshnessDto } from '../dto/market-freshness.dto';
import type { MarketFetchMode } from '../dto/merged-market-matrix.dto';

interface FreshnessPolicyWindow {
  readonly staleAfterMs: number;
  readonly maxStaleMs: number;
  readonly baseFetchMode: Exclude<MarketFetchMode, 'fallback'>;
}

@Injectable()
export class MarketFreshnessPolicyService {
  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
  ) {}

  evaluateSourceState(
    source:
      | Pick<
          MarketStateSourceRecord,
          'sourceCode' | 'sourceKind' | 'sourceMetadata'
        >
      | Pick<
          MarketSnapshotRecord,
          'sourceCode' | 'sourceKind' | 'sourceMetadata'
        >,
    observedAt: Date,
    now: Date = new Date(),
  ): MarketFreshnessDto {
    const policyWindow = this.resolvePolicyWindow(source);
    const lagMs = Math.max(0, now.getTime() - observedAt.getTime());
    const state =
      lagMs <= policyWindow.staleAfterMs
        ? 'fresh'
        : lagMs <= policyWindow.maxStaleMs
          ? 'stale'
          : 'expired';

    return {
      state,
      lagMs,
      staleAfterMs: policyWindow.staleAfterMs,
      maxStaleMs: policyWindow.maxStaleMs,
      usable: state !== 'expired',
    };
  }

  resolveFetchMode(
    source:
      | Pick<
          MarketStateSourceRecord,
          'sourceCode' | 'sourceKind' | 'sourceMetadata'
        >
      | Pick<
          MarketSnapshotRecord,
          'sourceCode' | 'sourceKind' | 'sourceMetadata'
        >,
    freshness: MarketFreshnessDto,
    usedHistoricalFallback: boolean,
  ): MarketFetchMode {
    const baseFetchMode = this.resolvePolicyWindow(source).baseFetchMode;

    if (baseFetchMode === 'backup') {
      return 'backup';
    }

    // "fallback" is reserved for explicit reuse of an older historical
    // snapshot. A merely stale latest state keeps its native fetch mode and is
    // penalized through freshness instead of being conflated with fallback.
    if (usedHistoricalFallback) {
      return 'fallback';
    }

    return baseFetchMode;
  }

  applyConfidencePenalty(
    baseConfidence: number,
    freshness: MarketFreshnessDto,
    fetchMode: MarketFetchMode,
  ): number {
    let adjustedConfidence = baseConfidence;

    if (fetchMode === 'backup') {
      adjustedConfidence *= 0.7;
    }

    if (fetchMode === 'fallback') {
      adjustedConfidence *= 0.85;
    }

    if (freshness.state === 'stale') {
      const freshnessPenaltyRatio =
        Math.max(0, freshness.lagMs - freshness.staleAfterMs) /
        Math.max(1, freshness.maxStaleMs - freshness.staleAfterMs);

      adjustedConfidence *= Math.max(0.5, 1 - freshnessPenaltyRatio * 0.35);
    }

    if (freshness.state === 'expired') {
      return 0;
    }

    return Number(Math.max(0, Math.min(1, adjustedConfidence)).toFixed(4));
  }

  private resolvePolicyWindow(
    source:
      | Pick<
          MarketStateSourceRecord,
          'sourceCode' | 'sourceKind' | 'sourceMetadata'
        >
      | Pick<
          MarketSnapshotRecord,
          'sourceCode' | 'sourceKind' | 'sourceMetadata'
        >,
  ): FreshnessPolicyWindow {
    const sourceMetadata =
      source.sourceMetadata &&
      typeof source.sourceMetadata === 'object' &&
      !Array.isArray(source.sourceMetadata)
        ? (source.sourceMetadata as Record<string, unknown>)
        : {};
    const sourceRole =
      typeof sourceMetadata.role === 'string' ? sourceMetadata.role : undefined;
    const classification =
      typeof sourceMetadata.classification === 'string'
        ? sourceMetadata.classification
        : undefined;

    if (
      sourceRole === 'reference-only' ||
      classification === 'REFERENCE' ||
      source.sourceKind === SourceKind.AGGREGATOR
    ) {
      return {
        staleAfterMs: this.configService.backupAggregatorStaleAfterMs,
        maxStaleMs: this.configService.backupAggregatorStaleAfterMs * 2,
        baseFetchMode: 'backup',
      };
    }

    if (
      source.sourceCode === 'steam-snapshot' ||
      source.sourceKind === SourceKind.OFFICIAL
    ) {
      return {
        staleAfterMs: this.configService.steamSnapshotStaleAfterMs,
        maxStaleMs: this.configService.steamSnapshotMaxStaleMs,
        baseFetchMode: 'snapshot',
      };
    }

    if (source.sourceCode === 'skinport') {
      return {
        staleAfterMs: Math.max(
          this.configService.skinportCacheTtlMs * 2,
          10 * 60 * 1000,
        ),
        maxStaleMs: Math.max(
          this.configService.skinportCacheTtlMs * 12,
          60 * 60 * 1000,
        ),
        baseFetchMode: 'live',
      };
    }

    if (source.sourceCode === 'csfloat') {
      return {
        staleAfterMs: 10 * 60 * 1000,
        maxStaleMs: 2 * 60 * 60 * 1000,
        baseFetchMode: 'live',
      };
    }

    if (source.sourceCode === 'bitskins') {
      return {
        staleAfterMs: 12 * 60 * 1000,
        maxStaleMs: 4 * 60 * 60 * 1000,
        baseFetchMode: 'live',
      };
    }

    if (source.sourceCode === 'waxpeer') {
      return {
        staleAfterMs: 12 * 60 * 1000,
        maxStaleMs: 4 * 60 * 60 * 1000,
        baseFetchMode: 'live',
      };
    }

    if (source.sourceCode === 'youpin') {
      return {
        staleAfterMs: 18 * 60 * 1000,
        maxStaleMs: 4 * 60 * 60 * 1000,
        baseFetchMode: 'live',
      };
    }

    if (source.sourceCode === 'c5game') {
      return {
        staleAfterMs: 20 * 60 * 1000,
        maxStaleMs: 5 * 60 * 60 * 1000,
        baseFetchMode: 'live',
      };
    }

    if (source.sourceCode === 'csmoney') {
      return {
        staleAfterMs: 15 * 60 * 1000,
        maxStaleMs: 3 * 60 * 60 * 1000,
        baseFetchMode: 'live',
      };
    }

    return {
      staleAfterMs: 15 * 60 * 1000,
      maxStaleMs: 2 * 60 * 60 * 1000,
      baseFetchMode: 'live',
    };
  }
}
