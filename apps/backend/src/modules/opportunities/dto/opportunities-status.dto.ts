export class OpportunitiesStatusDto {
  readonly module = 'opportunities';
  readonly status = 'ready';
  readonly strategy = 'scanner-universe-management-and-opportunity-engine';
  readonly capabilities = [
    'hot-warm-cold-tiering',
    'category-aware-universe-rules',
    'prioritized-source-polling',
    'manual-hot-overrides',
    'dynamic-promotion-and-demotion',
    'pairwise-opportunity-evaluation',
    'penalty-based-confidence-scoring',
  ] as const;
}
