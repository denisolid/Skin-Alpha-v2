export type ItemCategory = 'SKIN' | 'KNIFE' | 'GLOVE' | 'CASE' | 'CAPSULE';

export type SourceAdapterKey =
  | 'skinport'
  | 'csfloat'
  | 'dmarket'
  | 'waxpeer'
  | 'youpin'
  | 'bitskins'
  | 'c5game'
  | 'csmoney'
  | 'steam-snapshot'
  | 'backup-aggregator';

export type ScannerItemTier = 'hot' | 'warm' | 'cold';
export type OpportunityRiskClass = 'low' | 'medium' | 'high' | 'extreme';
export type AccessTier = 'free' | 'full_access' | 'alpha_access';
export type OpportunityDisposition =
  | 'candidate'
  | 'near_eligible'
  | 'eligible'
  | 'risky_high_upside'
  | 'rejected';
export type OpportunitySurfaceTier =
  | 'tradable'
  | 'reference_backed'
  | 'near_eligible'
  | 'research'
  | 'rejected';
export type OpportunityBlockerReason =
  | 'steam_snapshot_pair'
  | 'listed_exit_only'
  | 'fallback_data'
  | 'low_expected_net'
  | 'low_spread_percent'
  | 'low_confidence'
  | 'low_liquidity'
  | 'strict_variant_key_missing'
  | 'strict_variant_key_mismatch'
  | 'pre_score_outlier'
  | 'insufficient_comparables'
  | 'stale_sources';
export type OpportunityRiskReasonSeverity = 'info' | 'warning' | 'critical';
export type MarketFetchMode = 'live' | 'snapshot' | 'fallback' | 'backup';

export interface CurrentUserIdentity {
  readonly id: string;
  readonly provider: 'EMAIL' | 'GOOGLE' | 'DISCORD' | 'STEAM';
  readonly email: string | null;
  readonly createdAt: string;
  readonly lastAuthenticatedAt: string | null;
}

export interface CurrentUser {
  readonly id: string;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly role: 'USER' | 'ADMIN';
  readonly status: 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'DISABLED';
  readonly emailVerifiedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly identities: readonly CurrentUserIdentity[];
}

export interface AuthSessionResponse {
  readonly user: CurrentUser;
  readonly session: {
    readonly id: string;
    readonly expiresAt: string;
    readonly lastUsedAt: string | null;
    readonly createdAt: string;
  };
}

export interface SubscriptionEntitlements {
  readonly limitedFeed: boolean;
  readonly fullFeed: boolean;
  readonly alphaFeatures: boolean;
}

export interface CurrentSubscription {
  readonly accessTier: AccessTier;
  readonly entitlements: SubscriptionEntitlements;
  readonly subscription: {
    readonly id: string;
    readonly provider: 'STRIPE' | 'MANUAL' | 'APP_STORE' | 'PLAY_STORE';
    readonly plan: 'FREE' | 'FULL_ACCESS' | 'ALPHA_ACCESS';
    readonly status:
      | 'TRIALING'
      | 'ACTIVE'
      | 'PAST_DUE'
      | 'CANCELED'
      | 'EXPIRED';
    readonly currentPeriodStart: string | null;
    readonly currentPeriodEnd: string | null;
    readonly cancelAtPeriodEnd: boolean;
    readonly canceledAt: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
  };
}

export interface ExternalAuthUrlResponse {
  readonly provider: 'google' | 'steam';
  readonly intent: 'login' | 'link';
  readonly authorizationUrl: string;
}

export interface OpportunityFeedPageInfo {
  readonly generatedAt: string;
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
  readonly evaluatedVariantCount: number;
  readonly sortBy: 'expected_profit' | 'confidence' | 'freshness' | 'liquidity';
  readonly sortDirection: 'asc' | 'desc';
}

export interface OpportunityFeedFilters {
  readonly sourcePair?: string;
  readonly category?: ItemCategory;
  readonly minProfit?: number;
  readonly minConfidence?: number;
  readonly itemType?: string;
  readonly tier?: ScannerItemTier;
}

export interface OpportunityFeedSummary {
  readonly candidate: number;
  readonly nearEligible: number;
  readonly eligible: number;
  readonly riskyHighUpside: number;
  readonly tradable: number;
  readonly referenceBacked: number;
  readonly nearEligibleTier: number;
  readonly research: number;
}

export interface OpportunityFeedDiagnosticCount {
  readonly key: string;
  readonly count: number;
}

export interface OpportunityFeedSourcePairDiagnostic {
  readonly sourcePairKey: string;
  readonly overlapCount: number;
  readonly directionalEvaluationCount: number;
  readonly directionalBuyAskCount: number;
  readonly directionalSellExitCount: number;
  readonly directionalFirmExitCount: number;
  readonly directionalListedExitOnlyCount: number;
  readonly directionalMissingSignalCount: number;
  readonly pairableVariantCount: number;
  readonly blockedBeforePairabilityCount: number;
  readonly blockedAfterPairabilityCount: number;
  readonly nearMissCandidateCount: number;
  readonly eligibleCount: number;
  readonly visibleFeedCount: number;
  readonly topBlockers: readonly OpportunityFeedDiagnosticCount[];
}

export interface OpportunityFeedCoverageImbalance {
  readonly dominantSource: SourceAdapterKey;
  readonly dominantCoverageCount: number;
  readonly bottleneckSource: SourceAdapterKey;
  readonly bottleneckCoverageCount: number;
  readonly coverageRatio: number;
}

export interface OpportunityFeedRejectionSummary {
  readonly variantsRejectedForMissingCounterSource: number;
  readonly variantsRejectedForLowOverlapOrLowPairability: number;
  readonly pairsRejectedForCanonicalOrVariantMismatch: number;
  readonly pairsRejectedForFeesOrExecutionNet: number;
  readonly pairsRejectedForMinProfit: number;
  readonly pairsRejectedForConfidenceThreshold: number;
  readonly pairsRejectedForBlockerOrRiskRules: number;
  readonly pairsRejectedForFreshnessOrLiquidity: number;
  readonly primaryRejectStages: readonly OpportunityFeedDiagnosticCount[];
  readonly blockerCountsByReason: readonly OpportunityFeedDiagnosticCount[];
  readonly topRejectReasons: readonly OpportunityFeedDiagnosticCount[];
  readonly topBlockerReasons: readonly OpportunityFeedDiagnosticCount[];
}

export interface OpportunityFeedDiagnostics {
  readonly scannedVariantCount: number;
  readonly variantsWithCounterSourceCandidate: number;
  readonly noPairablePairCount: number;
  readonly evaluatedPairCount: number;
  readonly pairableCount: number;
  readonly blockedBeforePairabilityCount: number;
  readonly blockedAfterPairabilityCount: number;
  readonly nearMissCandidateCount: number;
  readonly eligibleCount: number;
  readonly visibleFeedCount: number;
  readonly validOpportunityCount: number;
  readonly feedEligibleCount: number;
  readonly blockedButPresentCount: number;
  readonly listedExitOnlyCount: number;
  readonly strictVariantIdentityRejectCount: number;
  readonly staleRejectCount: number;
  readonly missingMarketSignalRejectCount: number;
  readonly buySourceHasNoAskRejectCount: number;
  readonly sellSourceHasNoExitSignalRejectCount: number;
  readonly lowConfidenceCandidateCount: number;
  readonly hiddenByFeedQueryFilters: number;
  readonly averageExecutionNetAfterFees?: number;
  readonly sourceCoverageImbalance?: OpportunityFeedCoverageImbalance;
  readonly pipelineDiagnostics: readonly OpportunityFeedDiagnosticCount[];
  readonly overlapBySourcePair: readonly OpportunityFeedSourcePairDiagnostic[];
  readonly rejectionSummary: OpportunityFeedRejectionSummary;
}

export interface OpportunitySourceLeg {
  readonly source: SourceAdapterKey;
  readonly sourceName: string;
  readonly marketUrl?: string;
  readonly listingUrl?: string;
  readonly ask?: number;
  readonly bid?: number;
  readonly listedQty?: number;
  readonly observedAt: string;
  readonly fetchMode: MarketFetchMode;
  readonly confidence: number;
  readonly snapshotId?: string;
  readonly rawPayloadArchiveId?: string;
}

export interface OpportunityPublicFeedItem {
  readonly opportunityKey: string;
  readonly disposition: OpportunityDisposition;
  readonly surfaceTier: OpportunitySurfaceTier;
  readonly riskClass: OpportunityRiskClass;
  readonly category: ItemCategory;
  readonly itemType: string;
  readonly tier: ScannerItemTier;
  readonly canonicalDisplayName: string;
  readonly variantDisplayName: string;
  readonly itemVariantId: string;
  readonly sourcePairKey: string;
  readonly buySource: SourceAdapterKey;
  readonly buySourceName: string;
  readonly sellSource: SourceAdapterKey;
  readonly sellSourceName: string;
  readonly expectedNetProfit: number;
  readonly finalConfidence: number;
  readonly freshness: number;
  readonly liquidity: number;
  readonly blockerReason?: OpportunityBlockerReason;
  readonly observedAt: string;
}

export interface OpportunityPenaltyBreakdown {
  readonly freshnessPenalty: number;
  readonly liquidityPenalty: number;
  readonly stalePenalty: number;
  readonly categoryPenalty: number;
  readonly sourceDisagreementPenalty: number;
  readonly backupConfirmationBoost: number;
  readonly totalPenalty: number;
}

export interface OpportunityRiskReason {
  readonly code: string;
  readonly severity: OpportunityRiskReasonSeverity;
  readonly detail: string;
}

export interface OpportunityComponentScores {
  readonly mappingConfidence: number;
  readonly priceConfidence: number;
  readonly liquidityConfidence: number;
  readonly freshnessConfidence: number;
  readonly sourceReliabilityConfidence: number;
  readonly variantMatchConfidence: number;
}

export interface OpportunityExecutionBreakdown {
  readonly realizedSellPrice: number;
  readonly buyPrice: number;
  readonly fees: number;
  readonly slippagePenalty: number;
  readonly liquidityPenalty: number;
  readonly uncertaintyPenalty: number;
  readonly expectedNet: number;
}

export interface OpportunityStrictTradableKey {
  readonly key: string;
  readonly condition: string;
  readonly stattrak: boolean;
  readonly souvenir: boolean;
  readonly vanilla: boolean;
  readonly phase: string;
  readonly patternSensitiveBucket: string;
  readonly floatBucket: string;
}

export interface OpportunityStrictTradableMatch {
  readonly matched: boolean;
  readonly buyKey?: OpportunityStrictTradableKey;
  readonly sellKey?: OpportunityStrictTradableKey;
}

export interface OpportunityPreScoreGate {
  readonly passed: boolean;
  readonly comparableCount: number;
  readonly sourceMedian?: number;
  readonly crossSourceConsensus?: number;
  readonly rejectedByStale: boolean;
  readonly rejectedByMedian: boolean;
  readonly rejectedByConsensus: boolean;
  readonly rejectedByComparableCount: boolean;
  readonly reasonCodes: readonly string[];
}

export interface OpportunityEligibility {
  readonly surfaceTier: OpportunitySurfaceTier;
  readonly eligible: boolean;
  readonly requiresReferenceSupport: boolean;
  readonly steamSnapshotDemoted: boolean;
  readonly blockerReason?: OpportunityBlockerReason;
}

export interface OpportunityValidation {
  readonly status: 'passed' | 'warned' | 'rejected';
  readonly hardReject: boolean;
  readonly matchConfidence: number;
  readonly premiumContaminationRisk: number;
  readonly marketSanityRisk: number;
  readonly confirmationScore: number;
  readonly reasonCodes: readonly string[];
}

export interface OpportunityAntiFakeAssessment {
  readonly hardReject: boolean;
  readonly riskScore: number;
  readonly matchConfidence: number;
  readonly premiumContaminationRisk: number;
  readonly marketSanityRisk: number;
  readonly confirmationScore: number;
  readonly reasonCodes: readonly string[];
}

export interface OpportunityPairability {
  readonly status: 'pairable' | 'listed_exit_only' | 'blocked';
  readonly sameSourceBlocked: boolean;
  readonly listedExitOnly: boolean;
  readonly usesFallbackData: boolean;
  readonly schemeBlocked: boolean;
}

export interface OpportunityExplainability {
  readonly reasonCodes: readonly string[];
  readonly penalties: OpportunityPenaltyBreakdown;
}

export interface OpportunityRankingInputs {
  readonly surfaceTierRank: number;
  readonly dispositionRank: number;
  readonly bucketBase: number;
  readonly qualityScore: number;
  readonly penaltyScore: number;
  readonly rankScore: number;
  readonly freshnessScore: number;
  readonly liquidityScore: number;
  readonly pairabilityScore: number;
  readonly variantCertainty: number;
  readonly sourceReliability: number;
  readonly feeAdjustedNetProfit: number;
  readonly feeAdjustedSpreadPercent: number;
}

export interface OpportunityFullFeedItem extends OpportunityPublicFeedItem {
  readonly canonicalItemId: string;
  readonly rawSpread: number;
  readonly rawSpreadPercent: number;
  readonly feesAdjustedSpread: number;
  readonly expectedExitPrice: number;
  readonly estimatedSellFeeRate: number;
  readonly buyCost: number;
  readonly sellSignalPrice: number;
  readonly buy: OpportunitySourceLeg;
  readonly sell: OpportunitySourceLeg;
  readonly riskReasons: readonly OpportunityRiskReason[];
  readonly componentScores: OpportunityComponentScores;
  readonly execution: OpportunityExecutionBreakdown;
  readonly strictTradable: OpportunityStrictTradableMatch;
  readonly preScoreGate: OpportunityPreScoreGate;
  readonly eligibility: OpportunityEligibility;
  readonly validation: OpportunityValidation;
  readonly pairability: OpportunityPairability;
  readonly explainability: OpportunityExplainability;
  readonly rankingInputs: OpportunityRankingInputs;
  readonly backupConfirmation?: {
    readonly source: SourceAdapterKey;
    readonly sourceName: string;
    readonly referencePrice: number;
  };
}

export interface OpportunityFeedPage<TItem> {
  readonly pageInfo: OpportunityFeedPageInfo;
  readonly filters: OpportunityFeedFilters;
  readonly summary: OpportunityFeedSummary;
  readonly diagnostics: OpportunityFeedDiagnostics;
  readonly items: readonly TItem[];
}

export type OpportunityPublicFeedPage =
  OpportunityFeedPage<OpportunityPublicFeedItem>;
export type OpportunityFullFeedPage =
  OpportunityFeedPage<OpportunityFullFeedItem>;

export interface OpportunityRejectDiagnosticItem extends OpportunityFullFeedItem {
  readonly reasonCodes: readonly string[];
  readonly penalties: OpportunityPenaltyBreakdown;
  readonly antiFakeAssessment: OpportunityAntiFakeAssessment;
  readonly primaryRejectStage: string;
  readonly blockerClass: 'market_real' | 'system_induced' | 'mixed';
  readonly prePairRejectReason?: string;
  readonly postPairRejectReason?: string;
  readonly overlapExisted: boolean;
  readonly pairReachedPairability: boolean;
  readonly blockedBeforePairability: boolean;
  readonly blockedAfterPairability: boolean;
  readonly listedExitOnly: boolean;
  readonly blockedButPresentCandidate: boolean;
  readonly strictVariantIdentityRejected: boolean;
  readonly strictIdentityDetails?: {
    readonly status: 'missing_key' | 'mismatch';
    readonly differingFields: readonly string[];
  };
  readonly staleRejected: boolean;
  readonly missingMarketSignalRejected: boolean;
  readonly failedOnlyBecauseListedExit: boolean;
  readonly failedOnlyBecauseStale: boolean;
  readonly failedOnlyBecauseStrictVariantKey: boolean;
}

export interface OpportunityRejectDiagnosticsPage {
  readonly pageInfo: OpportunityFeedPageInfo;
  readonly filters: OpportunityFeedFilters;
  readonly totalRejected: number;
  readonly items: readonly OpportunityRejectDiagnosticItem[];
}

export interface SourceOperationalSummaryItem {
  readonly source: SourceAdapterKey;
  readonly sourceName: string;
  readonly sourceKind: 'MARKETPLACE' | 'AGGREGATOR' | 'INVENTORY_SERVICE' | 'OFFICIAL';
  readonly isEnabled: boolean;
  readonly classification?: string;
  readonly rawPayloadArchivesCount: number;
  readonly sourceListingsCount: number;
  readonly sourceMarketFactsCount: number;
  readonly marketSnapshotsCount: number;
  readonly marketStatesCount: number;
  readonly pendingMappingsCount: number;
  readonly unresolvedMappingSignalCount: number;
  readonly latestRawPayloadObservedAt?: string;
  readonly latestMarketStateObservedAt?: string;
  readonly latestNormalizedAt?: string;
  readonly rawToStateLagMs?: number;
  readonly projectionAmplificationRatio?: number;
  readonly usefulPayloadRatio?: number;
  readonly unchangedProjectionSkipCount: number;
}

export interface SourceOperationalSummary {
  readonly generatedAt: string;
  readonly variantsWithTwoPlusSources: number;
  readonly variantsWithThreePlusSources: number;
  readonly sources: readonly SourceOperationalSummaryItem[];
}

export interface WatchlistItem {
  readonly id: string;
  readonly canonicalItemId: string;
  readonly canonicalDisplayName: string;
  readonly itemVariantId: string;
  readonly variantDisplayName: string;
  readonly category: ItemCategory;
  readonly scopeKey: string;
  readonly notes?: string;
  readonly source?: {
    readonly id: string;
    readonly code: SourceAdapterKey;
    readonly name: string;
  };
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Watchlist {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly isDefault: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly itemCount: number;
  readonly items: readonly WatchlistItem[];
}

export interface WatchlistsResponse {
  readonly watchlists: readonly Watchlist[];
}

export interface CatalogBootstrapResult {
  readonly universe: string;
  readonly seededItemCount: number;
  readonly canonicalItemsCreated: number;
  readonly itemVariantsCreated: number;
  readonly seedItems: {
    readonly existingMatched: number;
    readonly created: number;
    readonly updated: number;
    readonly skipped: number;
    readonly failed: number;
  };
  readonly canonicalItems: {
    readonly existingMatched: number;
    readonly created: number;
    readonly updated: number;
    readonly skipped: number;
    readonly failed: number;
  };
  readonly itemVariants: {
    readonly existingMatched: number;
    readonly created: number;
    readonly updated: number;
    readonly skipped: number;
    readonly failed: number;
  };
  readonly results: readonly {
    readonly marketHashName: string;
    readonly canonicalSlug?: string;
    readonly variantKey?: string;
    readonly status:
      | 'existingMatched'
      | 'created'
      | 'updated'
      | 'skipped'
      | 'failed';
    readonly canonicalItem: {
      readonly status:
        | 'existingMatched'
        | 'created'
        | 'updated'
        | 'skipped'
        | 'failed';
      readonly id?: string;
    };
    readonly itemVariant: {
      readonly status:
        | 'existingMatched'
        | 'created'
        | 'updated'
        | 'skipped'
        | 'failed';
      readonly id?: string;
    };
    readonly warnings: readonly string[];
    readonly failureReason?: string;
  }[];
  readonly warnings: readonly string[];
}

export interface SourceAcceptedJobRef {
  readonly syncType: 'LISTINGS' | 'MARKET_STATE';
  readonly queueName: string;
  readonly jobName: string;
  readonly externalJobId?: string;
  readonly jobRunId?: string;
}

export interface SourceSyncAccepted {
  readonly source: SourceAdapterKey;
  readonly trigger:
    | 'bootstrap'
    | 'scheduled'
    | 'manual'
    | 'recovery'
    | 'fallback';
  readonly mode: 'full-snapshot' | 'incremental' | 'market-state-only';
  readonly acceptedAt: string;
  readonly acceptedJobs: readonly SourceAcceptedJobRef[];
  readonly warnings: readonly string[];
}

export interface SourceSyncBatchAccepted {
  readonly requestedAt: string;
  readonly acceptedSourceCount: number;
  readonly acceptedJobCount: number;
  readonly results: readonly SourceSyncAccepted[];
  readonly failures: readonly {
    readonly source: SourceAdapterKey;
    readonly error: string;
  }[];
}

export interface MarketStateRebuildResult {
  readonly processedSnapshotCount: number;
  readonly rebuiltStateCount: number;
  readonly unchangedProjectionSkipCount: number;
}

export interface OpportunityRescanResult {
  readonly scannedVariantCount: number;
  readonly evaluatedPairCount: number;
  readonly openOpportunityCount: number;
  readonly persistedOpportunityCount: number;
  readonly expiredOpportunityCount: number;
  readonly skippedMissingSnapshotCount: number;
  readonly variantFunnel: {
    readonly scanned: number;
    readonly withFetchedRows: number;
    readonly withNormalizedRows: number;
    readonly withCanonicalMatchedRows: number;
    readonly withEvaluatedPairs: number;
    readonly withPairablePairs: number;
    readonly withCandidatePairs: number;
    readonly withEligiblePairs: number;
    readonly withSurfacedPairs: number;
  };
  readonly pairFunnel: {
    readonly evaluated: number;
    readonly returned: number;
    readonly rejected: number;
    readonly blocked: number;
    readonly listedExitOnly: number;
    readonly softListedExitOnly: number;
    readonly pairable: number;
    readonly buySourceHasNoAsk: number;
    readonly sellSourceHasNoExitSignal: number;
    readonly strictVariantKeyMissing: number;
    readonly strictVariantKeyMismatch: number;
    readonly preScoreRejected: number;
    readonly antiFakeRejected: number;
    readonly nearEqualAfterFees: number;
    readonly trueNonPositiveEdge: number;
    readonly negativeExpectedNet: number;
    readonly confidenceBelowCandidateFloor: number;
    readonly otherRejected: number;
    readonly candidate: number;
    readonly nearEligible: number;
    readonly eligible: number;
    readonly riskyHighUpside: number;
  };
  readonly topRejectReasons: readonly {
    readonly reasonCode: string;
    readonly count: number;
  }[];
  readonly topBlockerReasons: readonly {
    readonly blockerReason: string;
    readonly count: number;
  }[];
}
