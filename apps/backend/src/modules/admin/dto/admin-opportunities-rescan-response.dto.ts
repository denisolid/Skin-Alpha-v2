export interface AdminOpportunitiesRescanResponseDto {
  readonly scannedVariantCount: number;
  readonly evaluatedPairCount: number;
  readonly openOpportunityCount: number;
  readonly persistedOpportunityCount: number;
  readonly expiredOpportunityCount: number;
  readonly skippedMissingSnapshotCount: number;
}
