import type { SourceSyncMode } from './source-adapter.types';

export interface SourceCapabilitiesModel {
  readonly supportedSyncModes: readonly SourceSyncMode[];
  readonly supportsRawListingSnapshots: boolean;
  readonly supportsNormalizedListings: boolean;
  readonly supportsNormalizedMarketState: boolean;
  readonly supportsIncrementalSync: boolean;
  readonly supportsFloatMetadata: boolean;
  readonly supportsPatternMetadata: boolean;
  readonly supportsPhaseMetadata: boolean;
  readonly supportsVariantSignals: boolean;
  readonly supportsRateLimitTelemetry: boolean;
  readonly supportsHealthChecks: boolean;
  readonly supportsFallbackRole: boolean;
}
