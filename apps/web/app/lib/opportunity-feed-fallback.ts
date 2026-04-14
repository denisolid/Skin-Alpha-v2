import type {
  OpportunityFeedFilters,
  OpportunityFeedPage,
  OpportunityFeedPageInfo,
} from './types';

export function createEmptyOpportunityFeedPage<TItem>(input: {
  readonly page: number;
  readonly pageSize: number;
  readonly sortBy: OpportunityFeedPageInfo['sortBy'] | string;
  readonly sortDirection: OpportunityFeedPageInfo['sortDirection'] | string;
  readonly filters?: OpportunityFeedFilters;
}): OpportunityFeedPage<TItem> {
  return {
    pageInfo: {
      generatedAt: new Date().toISOString(),
      page: input.page,
      pageSize: input.pageSize,
      total: 0,
      totalPages: 1,
      evaluatedVariantCount: 0,
      sortBy: normalizeSortBy(input.sortBy),
      sortDirection: normalizeSortDirection(input.sortDirection),
    },
    filters: input.filters ?? {},
    summary: {
      candidate: 0,
      nearEligible: 0,
      eligible: 0,
      riskyHighUpside: 0,
      tradable: 0,
      referenceBacked: 0,
      nearEligibleTier: 0,
      research: 0,
    },
    diagnostics: {
      scannedVariantCount: 0,
      variantsWithCounterSourceCandidate: 0,
      noPairablePairCount: 0,
      evaluatedPairCount: 0,
      pairableCount: 0,
      blockedBeforePairabilityCount: 0,
      blockedAfterPairabilityCount: 0,
      nearMissCandidateCount: 0,
      eligibleCount: 0,
      visibleFeedCount: 0,
      validOpportunityCount: 0,
      feedEligibleCount: 0,
      blockedButPresentCount: 0,
      listedExitOnlyCount: 0,
      strictVariantIdentityRejectCount: 0,
      staleRejectCount: 0,
      missingMarketSignalRejectCount: 0,
      buySourceHasNoAskRejectCount: 0,
      sellSourceHasNoExitSignalRejectCount: 0,
      lowConfidenceCandidateCount: 0,
      hiddenByFeedQueryFilters: 0,
      pipelineDiagnostics: [],
      overlapBySourcePair: [],
      rejectionSummary: {
        variantsRejectedForMissingCounterSource: 0,
        variantsRejectedForLowOverlapOrLowPairability: 0,
        pairsRejectedForCanonicalOrVariantMismatch: 0,
        pairsRejectedForFeesOrExecutionNet: 0,
        pairsRejectedForMinProfit: 0,
        pairsRejectedForConfidenceThreshold: 0,
        pairsRejectedForBlockerOrRiskRules: 0,
        pairsRejectedForFreshnessOrLiquidity: 0,
        primaryRejectStages: [],
        blockerCountsByReason: [],
        topRejectReasons: [],
        topBlockerReasons: [],
      },
    },
    items: [],
  };
}

function normalizeSortBy(value: OpportunityFeedPageInfo['sortBy'] | string) {
  switch (value) {
    case 'confidence':
    case 'freshness':
    case 'liquidity':
      return value;
    case 'expected_profit':
    default:
      return 'expected_profit';
  }
}

function normalizeSortDirection(
  value: OpportunityFeedPageInfo['sortDirection'] | string,
) {
  return value === 'asc' ? 'asc' : 'desc';
}
