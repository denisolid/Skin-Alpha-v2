export const SCANNER_ITEM_TIERS = ['hot', 'warm', 'cold'] as const;

export type ScannerItemTier = (typeof SCANNER_ITEM_TIERS)[number];

export interface ScannerTierScoreComponents {
  readonly liquidity: number;
  readonly priceMovement: number;
  readonly sourceActivity: number;
  readonly pairability: number;
  readonly composite: number;
}

export interface ScannerTierDecision {
  readonly tier: ScannerItemTier;
  readonly promotionReasons: readonly string[];
  readonly demotionReasons: readonly string[];
}

export function clampUniverseScore(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(4));
}

export function promoteScannerItemTier(tier: ScannerItemTier): ScannerItemTier {
  switch (tier) {
    case 'cold':
      return 'warm';
    case 'warm':
      return 'hot';
    case 'hot':
      return 'hot';
  }
}

export function demoteScannerItemTier(tier: ScannerItemTier): ScannerItemTier {
  switch (tier) {
    case 'hot':
      return 'warm';
    case 'warm':
      return 'cold';
    case 'cold':
      return 'cold';
  }
}

export function getScannerTierRank(tier: ScannerItemTier): number {
  switch (tier) {
    case 'hot':
      return 0;
    case 'warm':
      return 1;
    case 'cold':
      return 2;
  }
}
