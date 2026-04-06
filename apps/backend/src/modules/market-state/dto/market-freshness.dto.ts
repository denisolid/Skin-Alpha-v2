export const MARKET_FRESHNESS_STATES = ['fresh', 'stale', 'expired'] as const;

export type MarketFreshnessState = (typeof MARKET_FRESHNESS_STATES)[number];

export interface MarketFreshnessDto {
  readonly state: MarketFreshnessState;
  readonly lagMs: number;
  readonly staleAfterMs: number;
  readonly maxStaleMs: number;
  readonly usable: boolean;
}
