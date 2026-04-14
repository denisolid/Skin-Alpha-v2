import type { ItemCategory } from '@prisma/client';

import type { AntiFakeAssessment, OpportunityAntiFakeCounters } from './anti-fake.model';
import type {
  OpportunityEvaluationDisposition,
  OpportunityBlockerReason,
  OpportunityEngineRiskClass,
  OpportunityRiskReasonCode,
  OpportunityRiskReasonSeverity,
  OpportunityReasonCode,
  OpportunitySurfaceTier,
} from './opportunity-engine.model';
import type { MergedMarketMatrixDto, MarketFetchMode } from '../../market-state/dto/merged-market-matrix.dto';
import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';
import type { CompiledScheme } from '../../schemes/domain/scheme.model';

export interface EvaluateOpportunityVariantInput {
  readonly includeRejected?: boolean;
  readonly maxPairs?: number;
  readonly allowHistoricalFallback?: boolean;
  readonly scheme?: CompiledScheme;
}

export interface EvaluateOpportunityVariantsInput extends EvaluateOpportunityVariantInput {
  readonly itemVariantIds: readonly string[];
}

export interface OpportunityPenaltyBreakdownDto {
  readonly freshnessPenalty: number;
  readonly liquidityPenalty: number;
  readonly stalePenalty: number;
  readonly categoryPenalty: number;
  readonly sourceDisagreementPenalty: number;
  readonly backupConfirmationBoost: number;
  readonly totalPenalty: number;
}

export interface OpportunitySourceLegDto {
  readonly source: SourceAdapterKey;
  readonly sourceName: string;
  readonly marketUrl?: string;
  readonly listingUrl?: string;
  readonly ask?: number;
  readonly bid?: number;
  readonly listedQty?: number;
  readonly observedAt: Date;
  readonly fetchMode: MarketFetchMode;
  readonly confidence: number;
  readonly snapshotId?: string;
  readonly rawPayloadArchiveId?: string;
}

export interface OpportunityComponentScoresDto {
  readonly mappingConfidence: number;
  readonly priceConfidence: number;
  readonly liquidityConfidence: number;
  readonly freshnessConfidence: number;
  readonly sourceReliabilityConfidence: number;
  readonly variantMatchConfidence: number;
}

export interface OpportunityExecutionBreakdownDto {
  readonly realizedSellPrice: number;
  readonly buyPrice: number;
  readonly fees: number;
  readonly slippagePenalty: number;
  readonly liquidityPenalty: number;
  readonly uncertaintyPenalty: number;
  readonly expectedNet: number;
}

export interface OpportunityRiskReasonDto {
  readonly code: OpportunityRiskReasonCode;
  readonly severity: OpportunityRiskReasonSeverity;
  readonly detail: string;
}

export interface OpportunityStrictTradableKeyDto {
  readonly key: string;
  readonly condition: string;
  readonly stattrak: boolean;
  readonly souvenir: boolean;
  readonly vanilla: boolean;
  readonly phase: string;
  readonly patternSensitiveBucket: string;
  readonly floatBucket: string;
}

export interface OpportunityStrictTradableMatchDto {
  readonly matched: boolean;
  readonly buyKey?: OpportunityStrictTradableKeyDto;
  readonly sellKey?: OpportunityStrictTradableKeyDto;
}

export interface OpportunityPreScoreGateDto {
  readonly passed: boolean;
  readonly comparableCount: number;
  readonly sourceMedian?: number;
  readonly crossSourceConsensus?: number;
  readonly rejectedByStale: boolean;
  readonly rejectedByMedian: boolean;
  readonly rejectedByConsensus: boolean;
  readonly rejectedByComparableCount: boolean;
  readonly reasonCodes: readonly OpportunityReasonCode[];
}

export interface OpportunityEligibilityDto {
  readonly surfaceTier: OpportunitySurfaceTier;
  readonly eligible: boolean;
  readonly requiresReferenceSupport: boolean;
  readonly steamSnapshotDemoted: boolean;
  readonly blockerReason?: OpportunityBlockerReason;
}

export interface OpportunityFunnelMetricsDto {
  readonly fetched: number;
  readonly normalized: number;
  readonly canonicalMatched: number;
  readonly pairable: number;
  readonly candidate: number;
  readonly eligible: number;
  readonly surfaced: number;
}

export type OpportunityValidationStatus = 'passed' | 'warned' | 'rejected';

export interface OpportunityValidationDto {
  readonly status: OpportunityValidationStatus;
  readonly hardReject: boolean;
  readonly matchConfidence: number;
  readonly premiumContaminationRisk: number;
  readonly marketSanityRisk: number;
  readonly confirmationScore: number;
  readonly reasonCodes: readonly OpportunityReasonCode[];
}

export type OpportunityPairabilityStatus =
  | 'pairable'
  | 'listed_exit_only'
  | 'blocked';

export interface OpportunityPairabilityDto {
  readonly status: OpportunityPairabilityStatus;
  readonly sameSourceBlocked: boolean;
  readonly listedExitOnly: boolean;
  readonly usesFallbackData: boolean;
  readonly schemeBlocked: boolean;
}

export interface OpportunityExplainabilityDto {
  readonly reasonCodes: readonly OpportunityReasonCode[];
  readonly penalties: OpportunityPenaltyBreakdownDto;
}

export interface OpportunityRankingInputsDto {
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

export interface OpportunityEvaluationDto {
  readonly opportunityKey: string;
  readonly disposition: OpportunityEvaluationDisposition;
  readonly surfaceTier: OpportunitySurfaceTier;
  readonly reasonCodes: readonly OpportunityReasonCode[];
  readonly riskClass: OpportunityEngineRiskClass;
  readonly riskReasons: readonly OpportunityRiskReasonDto[];
  readonly category: ItemCategory;
  readonly canonicalItemId: string;
  readonly canonicalDisplayName: string;
  readonly itemVariantId: string;
  readonly variantDisplayName: string;
  readonly sourcePairKey: string;
  readonly buy: OpportunitySourceLegDto;
  readonly sell: OpportunitySourceLegDto;
  readonly rawSpread: number;
  readonly rawSpreadPercent: number;
  readonly feesAdjustedSpread: number;
  readonly expectedNetProfit: number;
  readonly expectedExitPrice: number;
  readonly estimatedSellFeeRate: number;
  readonly buyCost: number;
  readonly sellSignalPrice: number;
  readonly componentScores: OpportunityComponentScoresDto;
  readonly execution: OpportunityExecutionBreakdownDto;
  readonly finalConfidence: number;
  readonly penalties: OpportunityPenaltyBreakdownDto;
  readonly antiFakeAssessment: AntiFakeAssessment;
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

export interface OpportunityEngineVariantResultDto {
  readonly generatedAt: Date;
  readonly category: ItemCategory;
  readonly canonicalItemId: string;
  readonly canonicalDisplayName: string;
  readonly itemVariantId: string;
  readonly variantDisplayName: string;
  readonly evaluatedPairCount: number;
  readonly returnedPairCount: number;
  readonly dispositionSummary: Record<OpportunityEvaluationDisposition, number>;
  readonly antiFakeCounters: OpportunityAntiFakeCounters;
  readonly diagnostics: OpportunityFunnelMetricsDto;
  readonly evaluations: readonly OpportunityEvaluationDto[];
}

export interface OpportunityEngineScanResultDto {
  readonly generatedAt: Date;
  readonly evaluatedItemCount: number;
  readonly evaluatedPairCount: number;
  readonly dispositionSummary: Record<OpportunityEvaluationDisposition, number>;
  readonly antiFakeCounters: OpportunityAntiFakeCounters;
  readonly diagnostics: OpportunityFunnelMetricsDto;
  readonly results: readonly OpportunityEngineVariantResultDto[];
}

export interface EvaluateOpportunityMatrixInput {
  readonly matrix: MergedMarketMatrixDto;
  readonly includeRejected: boolean;
  readonly maxPairs: number;
  readonly scheme?: CompiledScheme;
}
