import type {
  OpportunityBlockerReason,
  OpportunityReasonCode,
} from '../domain/opportunity-engine.model';

export interface OpportunityRescanVariantFunnelDto {
  readonly scanned: number;
  readonly withFetchedRows: number;
  readonly withNormalizedRows: number;
  readonly withCanonicalMatchedRows: number;
  readonly withEvaluatedPairs: number;
  readonly withPairablePairs: number;
  readonly withCandidatePairs: number;
  readonly withEligiblePairs: number;
  readonly withSurfacedPairs: number;
}

export interface OpportunityRescanPairFunnelDto {
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
}

export interface OpportunityRescanRejectReasonCountDto {
  readonly reasonCode: OpportunityReasonCode;
  readonly count: number;
}

export interface OpportunityRescanBlockerCountDto {
  readonly blockerReason: OpportunityBlockerReason;
  readonly count: number;
}

export interface OpportunityRescanResultDto {
  readonly scannedVariantCount: number;
  readonly evaluatedPairCount: number;
  readonly openOpportunityCount: number;
  readonly persistedOpportunityCount: number;
  readonly expiredOpportunityCount: number;
  readonly skippedMissingSnapshotCount: number;
  readonly variantFunnel: OpportunityRescanVariantFunnelDto;
  readonly pairFunnel: OpportunityRescanPairFunnelDto;
  readonly topRejectReasons: readonly OpportunityRescanRejectReasonCountDto[];
  readonly topBlockerReasons: readonly OpportunityRescanBlockerCountDto[];
}
