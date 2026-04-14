import type { ItemCategory } from '@prisma/client';

import type {
  OpportunityComponentScoresDto,
  OpportunityEligibilityDto,
  OpportunityExecutionBreakdownDto,
  OpportunityExplainabilityDto,
  OpportunityPairabilityDto,
  OpportunityPenaltyBreakdownDto,
  OpportunityPreScoreGateDto,
  OpportunityRankingInputsDto,
  OpportunityRiskReasonDto,
  OpportunitySourceLegDto,
  OpportunityStrictTradableMatchDto,
  OpportunityValidationDto,
} from './opportunity-engine.dto';
import type {
  OpportunityFeedSortDirection,
  OpportunityFeedSortField,
} from './get-opportunity-feed.query.dto';
import type {
  OpportunityBlockerReason,
  OpportunityEvaluationDisposition,
  OpportunityEngineRiskClass,
  OpportunityReasonCode,
  OpportunitySurfaceTier,
} from '../domain/opportunity-engine.model';
import type { AntiFakeAssessment } from '../domain/anti-fake.model';
import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';
import type { ScannerItemTier } from '../domain/item-tier.model';

export interface OpportunityFeedPageInfoDto {
  readonly generatedAt: Date;
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
  readonly evaluatedVariantCount: number;
  readonly sortBy: OpportunityFeedSortField;
  readonly sortDirection: OpportunityFeedSortDirection;
}

export interface OpportunityFeedFiltersDto {
  readonly sourcePair?: string;
  readonly category?: ItemCategory;
  readonly minProfit?: number;
  readonly minConfidence?: number;
  readonly itemType?: string;
  readonly tier?: ScannerItemTier;
}

export interface OpportunityFeedSummaryDto {
  readonly candidate: number;
  readonly nearEligible: number;
  readonly eligible: number;
  readonly riskyHighUpside: number;
  readonly tradable: number;
  readonly referenceBacked: number;
  readonly nearEligibleTier: number;
  readonly research: number;
}

export interface OpportunityFeedDiagnosticCountDto {
  readonly key: string;
  readonly count: number;
}

export interface OpportunityFeedSourcePairDiagnosticDto {
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
  readonly topBlockers: readonly OpportunityFeedDiagnosticCountDto[];
}

export interface OpportunityFeedCoverageImbalanceDto {
  readonly dominantSource: SourceAdapterKey;
  readonly dominantCoverageCount: number;
  readonly bottleneckSource: SourceAdapterKey;
  readonly bottleneckCoverageCount: number;
  readonly coverageRatio: number;
}

export interface OpportunityStrictIdentityDiagnosticDto {
  readonly status: 'missing_key' | 'mismatch';
  readonly differingFields: readonly string[];
}

export interface OpportunityFeedRejectionSummaryDto {
  readonly variantsRejectedForMissingCounterSource: number;
  readonly variantsRejectedForLowOverlapOrLowPairability: number;
  readonly pairsRejectedForCanonicalOrVariantMismatch: number;
  readonly pairsRejectedForFeesOrExecutionNet: number;
  readonly pairsRejectedForMinProfit: number;
  readonly pairsRejectedForConfidenceThreshold: number;
  readonly pairsRejectedForBlockerOrRiskRules: number;
  readonly pairsRejectedForFreshnessOrLiquidity: number;
  readonly primaryRejectStages: readonly OpportunityFeedDiagnosticCountDto[];
  readonly blockerCountsByReason: readonly OpportunityFeedDiagnosticCountDto[];
  readonly topRejectReasons: readonly OpportunityFeedDiagnosticCountDto[];
  readonly topBlockerReasons: readonly OpportunityFeedDiagnosticCountDto[];
}

export interface OpportunityFeedDiagnosticsDto {
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
  readonly sourceCoverageImbalance?: OpportunityFeedCoverageImbalanceDto;
  readonly pipelineDiagnostics: readonly OpportunityFeedDiagnosticCountDto[];
  readonly overlapBySourcePair: readonly OpportunityFeedSourcePairDiagnosticDto[];
  readonly rejectionSummary: OpportunityFeedRejectionSummaryDto;
}

export interface OpportunityPublicFeedItemDto {
  readonly opportunityKey: string;
  readonly disposition: OpportunityEvaluationDisposition;
  readonly surfaceTier: OpportunitySurfaceTier;
  readonly riskClass: OpportunityEngineRiskClass;
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
  readonly observedAt: Date;
}

export interface OpportunityFullFeedItemDto extends OpportunityPublicFeedItemDto {
  readonly canonicalItemId: string;
  readonly rawSpread: number;
  readonly rawSpreadPercent: number;
  readonly feesAdjustedSpread: number;
  readonly expectedExitPrice: number;
  readonly estimatedSellFeeRate: number;
  readonly buyCost: number;
  readonly sellSignalPrice: number;
  readonly buy: OpportunitySourceLegDto;
  readonly sell: OpportunitySourceLegDto;
  readonly riskReasons: readonly OpportunityRiskReasonDto[];
  readonly componentScores: OpportunityComponentScoresDto;
  readonly execution: OpportunityExecutionBreakdownDto;
  readonly strictTradable: OpportunityStrictTradableMatchDto;
  readonly preScoreGate: OpportunityPreScoreGateDto;
  readonly eligibility: OpportunityEligibilityDto;
  readonly validation: OpportunityValidationDto;
  readonly pairability: OpportunityPairabilityDto;
  readonly explainability: OpportunityExplainabilityDto;
  readonly rankingInputs: OpportunityRankingInputsDto;
  readonly backupConfirmation?: {
    readonly source: SourceAdapterKey;
    readonly sourceName: string;
    readonly referencePrice: number;
  };
}

export type OpportunityDetailDto = OpportunityFullFeedItemDto;

export interface OpportunityRejectDiagnosticDto extends OpportunityFullFeedItemDto {
  readonly reasonCodes: readonly OpportunityReasonCode[];
  readonly penalties: OpportunityPenaltyBreakdownDto;
  readonly antiFakeAssessment: AntiFakeAssessment;
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
  readonly strictIdentityDetails?: OpportunityStrictIdentityDiagnosticDto;
  readonly staleRejected: boolean;
  readonly missingMarketSignalRejected: boolean;
  readonly failedOnlyBecauseListedExit: boolean;
  readonly failedOnlyBecauseStale: boolean;
  readonly failedOnlyBecauseStrictVariantKey: boolean;
}

export interface OpportunityPublicFeedPageDto {
  readonly pageInfo: OpportunityFeedPageInfoDto;
  readonly filters: OpportunityFeedFiltersDto;
  readonly summary: OpportunityFeedSummaryDto;
  readonly diagnostics: OpportunityFeedDiagnosticsDto;
  readonly items: readonly OpportunityPublicFeedItemDto[];
}

export interface OpportunityFullFeedPageDto {
  readonly pageInfo: OpportunityFeedPageInfoDto;
  readonly filters: OpportunityFeedFiltersDto;
  readonly summary: OpportunityFeedSummaryDto;
  readonly diagnostics: OpportunityFeedDiagnosticsDto;
  readonly items: readonly OpportunityFullFeedItemDto[];
}

export interface OpportunityRejectDiagnosticsPageDto {
  readonly pageInfo: OpportunityFeedPageInfoDto;
  readonly filters: OpportunityFeedFiltersDto;
  readonly totalRejected: number;
  readonly items: readonly OpportunityRejectDiagnosticDto[];
}
