export interface SourceBehaviorFlagsModel {
  readonly canDrivePrimaryTruth: boolean;
  readonly canProvideFallbackPricing: boolean;
  readonly canProvideQuantitySignals: boolean;
  readonly canBeUsedForPairBuilding: boolean;
  readonly canBeUsedForConfirmationOnly: boolean;
}
