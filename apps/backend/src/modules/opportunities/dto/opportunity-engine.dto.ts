import type { ItemCategory } from '@prisma/client';

import type {
  AntiFakeAssessment,
  OpportunityAntiFakeCounters,
} from '../domain/anti-fake.model';
import type { MarketFetchMode } from '../../market-state/dto/merged-market-matrix.dto';
import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';
import type {
  OpportunityEvaluationDisposition,
  OpportunityEngineRiskClass,
  OpportunityReasonCode,
} from '../domain/opportunity-engine.model';

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

export interface OpportunityEvaluationDto {
  readonly disposition: OpportunityEvaluationDisposition;
  readonly reasonCodes: readonly OpportunityReasonCode[];
  readonly riskClass: OpportunityEngineRiskClass;
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
  readonly finalConfidence: number;
  readonly penalties: OpportunityPenaltyBreakdownDto;
  readonly antiFakeAssessment: AntiFakeAssessment;
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
  readonly evaluations: readonly OpportunityEvaluationDto[];
}

export interface OpportunityEngineScanResultDto {
  readonly generatedAt: Date;
  readonly evaluatedItemCount: number;
  readonly evaluatedPairCount: number;
  readonly dispositionSummary: Record<OpportunityEvaluationDisposition, number>;
  readonly antiFakeCounters: OpportunityAntiFakeCounters;
  readonly results: readonly OpportunityEngineVariantResultDto[];
}
