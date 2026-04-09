import type { ItemCategory } from '@prisma/client';

import type {
  OpportunityExplainabilityDto,
  OpportunityPairabilityDto,
  OpportunityPenaltyBreakdownDto,
  OpportunityRankingInputsDto,
  OpportunitySourceLegDto,
  OpportunityValidationDto,
} from './opportunity-engine.dto';
import type {
  OpportunityFeedSortDirection,
  OpportunityFeedSortField,
} from './get-opportunity-feed.query.dto';
import type {
  OpportunityEvaluationDisposition,
  OpportunityEngineRiskClass,
  OpportunityReasonCode,
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
}

export interface OpportunityPublicFeedItemDto {
  readonly opportunityKey: string;
  readonly disposition: OpportunityEvaluationDisposition;
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
}

export interface OpportunityPublicFeedPageDto {
  readonly pageInfo: OpportunityFeedPageInfoDto;
  readonly filters: OpportunityFeedFiltersDto;
  readonly summary: OpportunityFeedSummaryDto;
  readonly items: readonly OpportunityPublicFeedItemDto[];
}

export interface OpportunityFullFeedPageDto {
  readonly pageInfo: OpportunityFeedPageInfoDto;
  readonly filters: OpportunityFeedFiltersDto;
  readonly summary: OpportunityFeedSummaryDto;
  readonly items: readonly OpportunityFullFeedItemDto[];
}

export interface OpportunityRejectDiagnosticsPageDto {
  readonly pageInfo: OpportunityFeedPageInfoDto;
  readonly filters: OpportunityFeedFiltersDto;
  readonly totalRejected: number;
  readonly items: readonly OpportunityRejectDiagnosticDto[];
}
