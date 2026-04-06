import { ItemCategory } from '@prisma/client';

import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';

interface SourceExecutionPolicy {
  readonly buyFeeRate: number;
  readonly sellFeeRate: number;
  readonly askExitDiscountRate: number;
}

interface CategoryOpportunityPolicy {
  readonly minExpectedNet: number;
  readonly nearEligibleExpectedNet: number;
  readonly minSpreadPercent: number;
  readonly nearEligibleSpreadPercent: number;
  readonly minConfidenceEligible: number;
  readonly minConfidenceCandidate: number;
  readonly highUpsideNet: number;
  readonly baseCategoryPenalty: number;
  readonly liquidityTargetDepth: number;
}

export const OPPORTUNITY_SOURCE_EXECUTION_POLICIES: Readonly<
  Record<SourceAdapterKey, SourceExecutionPolicy>
> = {
  skinport: {
    buyFeeRate: 0,
    // Conservative default. Keep isolated here so exact marketplace fees can
    // be replaced later without touching engine logic.
    sellFeeRate: 0.12,
    askExitDiscountRate: 0.035,
  },
  csfloat: {
    buyFeeRate: 0,
    sellFeeRate: 0.02,
    askExitDiscountRate: 0.03,
  },
  bitskins: {
    buyFeeRate: 0,
    sellFeeRate: 0.1,
    askExitDiscountRate: 0.035,
  },
  youpin: {
    buyFeeRate: 0,
    sellFeeRate: 0.05,
    askExitDiscountRate: 0.03,
  },
  c5game: {
    buyFeeRate: 0,
    sellFeeRate: 0.06,
    askExitDiscountRate: 0.04,
  },
  csmoney: {
    buyFeeRate: 0,
    sellFeeRate: 0.07,
    askExitDiscountRate: 0.045,
  },
  'steam-snapshot': {
    buyFeeRate: 0,
    sellFeeRate: 0.15,
    askExitDiscountRate: 0.045,
  },
  'backup-aggregator': {
    buyFeeRate: 0,
    sellFeeRate: 0.12,
    askExitDiscountRate: 0.08,
  },
};

export const OPPORTUNITY_CATEGORY_POLICIES: Readonly<
  Record<ItemCategory, CategoryOpportunityPolicy>
> = {
  [ItemCategory.SKIN]: {
    minExpectedNet: 2.5,
    nearEligibleExpectedNet: 1.5,
    minSpreadPercent: 3.5,
    nearEligibleSpreadPercent: 2.4,
    minConfidenceEligible: 0.62,
    minConfidenceCandidate: 0.42,
    highUpsideNet: 15,
    baseCategoryPenalty: 0.035,
    liquidityTargetDepth: 12,
  },
  [ItemCategory.KNIFE]: {
    minExpectedNet: 12,
    nearEligibleExpectedNet: 7,
    minSpreadPercent: 2.2,
    nearEligibleSpreadPercent: 1.6,
    minConfidenceEligible: 0.56,
    minConfidenceCandidate: 0.36,
    highUpsideNet: 50,
    baseCategoryPenalty: 0.075,
    liquidityTargetDepth: 4,
  },
  [ItemCategory.GLOVE]: {
    minExpectedNet: 12,
    nearEligibleExpectedNet: 7,
    minSpreadPercent: 2.3,
    nearEligibleSpreadPercent: 1.6,
    minConfidenceEligible: 0.55,
    minConfidenceCandidate: 0.35,
    highUpsideNet: 55,
    baseCategoryPenalty: 0.08,
    liquidityTargetDepth: 4,
  },
  [ItemCategory.CASE]: {
    minExpectedNet: 1,
    nearEligibleExpectedNet: 0.6,
    minSpreadPercent: 4.2,
    nearEligibleSpreadPercent: 3,
    minConfidenceEligible: 0.64,
    minConfidenceCandidate: 0.45,
    highUpsideNet: 8,
    baseCategoryPenalty: 0.025,
    liquidityTargetDepth: 25,
  },
  [ItemCategory.CAPSULE]: {
    minExpectedNet: 1,
    nearEligibleExpectedNet: 0.6,
    minSpreadPercent: 4.2,
    nearEligibleSpreadPercent: 3,
    minConfidenceEligible: 0.64,
    minConfidenceCandidate: 0.45,
    highUpsideNet: 8,
    baseCategoryPenalty: 0.03,
    liquidityTargetDepth: 25,
  },
};
