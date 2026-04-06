export class MarketStateStatusDto {
  readonly module = 'market-state';
  readonly status = 'ready';
  readonly strategy = 'internal-normalized-market-state';
  readonly capabilities = [
    'latest-state-per-canonical-item-per-source',
    'append-only-snapshot-history',
    'freshness-evaluation',
    'source-conflict-analysis',
    'stale-fallback-selection',
    'merged-market-matrix',
  ] as const;
}
