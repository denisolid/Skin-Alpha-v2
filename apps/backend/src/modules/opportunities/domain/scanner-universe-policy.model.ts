import { ItemCategory } from '@prisma/client';

import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';
import type { ScannerItemTier } from './item-tier.model';

interface ScannerCategoryWeights {
  readonly liquidity: number;
  readonly priceMovement: number;
  readonly sourceActivity: number;
  readonly opportunityFrequency: number;
}

export interface ScannerCategoryPolicy {
  readonly hotThreshold: number;
  readonly warmThreshold: number;
  readonly liquidityListingDepthDivisor: number;
  readonly priceMovementReferencePercent: number;
  readonly sourceActivityTargetSources: number;
  readonly weights: ScannerCategoryWeights;
  readonly sourceBias: Partial<Record<SourceAdapterKey, number>>;
  readonly pollIntervalMultiplier: Partial<Record<SourceAdapterKey, number>>;
}

export const SCANNER_CATEGORY_POLICIES: Readonly<
  Record<ItemCategory, ScannerCategoryPolicy>
> = {
  [ItemCategory.SKIN]: {
    hotThreshold: 0.72,
    warmThreshold: 0.42,
    liquidityListingDepthDivisor: 30,
    priceMovementReferencePercent: 0.12,
    sourceActivityTargetSources: 2,
    weights: {
      liquidity: 0.34,
      priceMovement: 0.24,
      sourceActivity: 0.2,
      opportunityFrequency: 0.22,
    },
    sourceBias: {
      skinport: 12,
      csfloat: 10,
      bitskins: 10,
      youpin: 8,
      c5game: 7,
      csmoney: 6,
    },
    pollIntervalMultiplier: {
      skinport: 1,
      csfloat: 0.85,
      bitskins: 0.95,
      youpin: 1,
      c5game: 1.1,
      csmoney: 1.15,
      'steam-snapshot': 1.15,
      'backup-aggregator': 1.2,
    },
  },
  [ItemCategory.KNIFE]: {
    hotThreshold: 0.68,
    warmThreshold: 0.38,
    liquidityListingDepthDivisor: 14,
    priceMovementReferencePercent: 0.08,
    sourceActivityTargetSources: 2,
    weights: {
      liquidity: 0.26,
      priceMovement: 0.28,
      sourceActivity: 0.18,
      opportunityFrequency: 0.28,
    },
    sourceBias: {
      csfloat: 12,
      bitskins: 11,
      youpin: 9,
      c5game: 8,
      csmoney: 7,
      'steam-snapshot': 18,
      skinport: 6,
    },
    pollIntervalMultiplier: {
      skinport: 1.25,
      csfloat: 1,
      bitskins: 1.05,
      youpin: 1.1,
      c5game: 1.2,
      csmoney: 1.25,
      'steam-snapshot': 0.7,
      'backup-aggregator': 1.1,
    },
  },
  [ItemCategory.GLOVE]: {
    hotThreshold: 0.66,
    warmThreshold: 0.36,
    liquidityListingDepthDivisor: 12,
    priceMovementReferencePercent: 0.09,
    sourceActivityTargetSources: 2,
    weights: {
      liquidity: 0.25,
      priceMovement: 0.28,
      sourceActivity: 0.19,
      opportunityFrequency: 0.28,
    },
    sourceBias: {
      csfloat: 12,
      bitskins: 11,
      youpin: 9,
      c5game: 8,
      csmoney: 7,
      'steam-snapshot': 16,
      skinport: 6,
    },
    pollIntervalMultiplier: {
      skinport: 1.2,
      csfloat: 1,
      bitskins: 1.05,
      youpin: 1.1,
      c5game: 1.2,
      csmoney: 1.25,
      'steam-snapshot': 0.75,
      'backup-aggregator': 1.1,
    },
  },
  [ItemCategory.CASE]: {
    hotThreshold: 0.7,
    warmThreshold: 0.45,
    liquidityListingDepthDivisor: 140,
    priceMovementReferencePercent: 0.16,
    sourceActivityTargetSources: 2,
    weights: {
      liquidity: 0.4,
      priceMovement: 0.16,
      sourceActivity: 0.22,
      opportunityFrequency: 0.22,
    },
    sourceBias: {
      skinport: 14,
      csfloat: 8,
      bitskins: 8,
      youpin: 7,
      c5game: 6,
      csmoney: 5,
    },
    pollIntervalMultiplier: {
      skinport: 0.8,
      csfloat: 0.95,
      bitskins: 1,
      youpin: 1.05,
      c5game: 1.2,
      csmoney: 1.25,
      'steam-snapshot': 1.7,
      'backup-aggregator': 1.35,
    },
  },
  [ItemCategory.CAPSULE]: {
    hotThreshold: 0.68,
    warmThreshold: 0.44,
    liquidityListingDepthDivisor: 160,
    priceMovementReferencePercent: 0.16,
    sourceActivityTargetSources: 2,
    weights: {
      liquidity: 0.38,
      priceMovement: 0.16,
      sourceActivity: 0.22,
      opportunityFrequency: 0.24,
    },
    sourceBias: {
      skinport: 12,
      csfloat: 8,
      bitskins: 8,
      youpin: 7,
      c5game: 6,
      csmoney: 5,
    },
    pollIntervalMultiplier: {
      skinport: 0.85,
      csfloat: 1,
      bitskins: 1,
      youpin: 1.05,
      c5game: 1.2,
      csmoney: 1.25,
      'steam-snapshot': 1.8,
      'backup-aggregator': 1.4,
    },
  },
};

export const SCANNER_SOURCE_POLL_INTERVAL_SECONDS: Readonly<
  Record<SourceAdapterKey, Record<ScannerItemTier, number>>
> = {
  skinport: {
    hot: 180,
    warm: 600,
    cold: 1800,
  },
  csfloat: {
    hot: 60,
    warm: 300,
    cold: 900,
  },
  bitskins: {
    hot: 120,
    warm: 480,
    cold: 1800,
  },
  youpin: {
    hot: 180,
    warm: 600,
    cold: 2400,
  },
  c5game: {
    hot: 240,
    warm: 900,
    cold: 3600,
  },
  csmoney: {
    hot: 300,
    warm: 1200,
    cold: 5400,
  },
  'steam-snapshot': {
    hot: 900,
    warm: 1800,
    cold: 7200,
  },
  'backup-aggregator': {
    hot: 1800,
    warm: 3600,
    cold: 10800,
  },
};
