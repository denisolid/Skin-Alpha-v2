import type { OpportunityReasonCode } from './opportunity-engine.model';

export interface AntiFakeAssessment {
  readonly hardReject: boolean;
  readonly riskScore: number;
  readonly matchConfidence: number;
  readonly premiumContaminationRisk: number;
  readonly marketSanityRisk: number;
  readonly confirmationScore: number;
  readonly reasonCodes: readonly OpportunityReasonCode[];
}

export interface OpportunityAntiFakeCounters {
  readonly rejectedByMismatch: number;
  readonly rejectedByPremiumContamination: number;
  readonly rejectedByStaleState: number;
  readonly rejectedByLowConfidence: number;
  readonly rejectedByLiquidity: number;
  readonly rejectedByOutlier: number;
  readonly downgradedToRiskyHighUpside: number;
}
