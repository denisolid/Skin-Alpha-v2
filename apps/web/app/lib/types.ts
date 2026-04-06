export type ItemCategory = 'SKIN' | 'KNIFE' | 'GLOVE' | 'CASE' | 'CAPSULE';

export type SourceAdapterKey =
  | 'skinport'
  | 'csfloat'
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
  readonly disposition: OpportunityDisposition;
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
  readonly backupConfirmation?: {
    readonly source: SourceAdapterKey;
    readonly sourceName: string;
    readonly referencePrice: number;
  };
  readonly reasonCodes?: readonly string[];
  readonly penalties?: OpportunityPenaltyBreakdown;
}

export interface OpportunityFeedPage<TItem> {
  readonly pageInfo: OpportunityFeedPageInfo;
  readonly filters: OpportunityFeedFilters;
  readonly summary: OpportunityFeedSummary;
  readonly items: readonly TItem[];
}

export type OpportunityPublicFeedPage =
  OpportunityFeedPage<OpportunityPublicFeedItem>;
export type OpportunityFullFeedPage =
  OpportunityFeedPage<OpportunityFullFeedItem>;

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
}

export interface OpportunityRescanResult {
  readonly scannedVariantCount: number;
  readonly evaluatedPairCount: number;
  readonly openOpportunityCount: number;
  readonly persistedOpportunityCount: number;
  readonly expiredOpportunityCount: number;
  readonly skippedMissingSnapshotCount: number;
}
