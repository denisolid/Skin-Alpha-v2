import type { VariantPhase } from '@prisma/client';

export const CATALOG_PHASE_FAMILIES = [
  'vanilla',
  'standard',
  'doppler',
  'gamma-doppler',
] as const;

export type CatalogPhaseFamily = (typeof CATALOG_PHASE_FAMILIES)[number];

export interface CatalogPhaseNormalizationResult {
  readonly family: CatalogPhaseFamily;
  readonly phase?: VariantPhase;
  readonly phaseLabel?: string;
  readonly isDoppler: boolean;
  readonly isGammaDoppler: boolean;
  readonly isGammaPhase: boolean;
  readonly confidence: number;
  readonly warnings: readonly string[];
}
