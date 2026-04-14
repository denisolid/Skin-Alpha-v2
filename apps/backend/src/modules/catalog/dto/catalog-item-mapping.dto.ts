import type { ItemCategory, VariantPhase } from '@prisma/client';

import type { CatalogPhaseFamily } from '../domain/catalog-phase.model';
import type { VariantSignalSensitivity } from '../domain/variant-signal-policy.model';

export interface CatalogItemMappingDto {
  readonly marketHashName: string;
  readonly canonicalSlug: string;
  readonly canonicalDisplayName: string;
  readonly category: ItemCategory;
  readonly type: string;
  readonly weapon?: string;
  readonly skinName?: string;
  readonly exterior?: string;
  readonly rarity?: string;
  readonly stattrak: boolean;
  readonly souvenir: boolean;
  readonly defIndex?: number;
  readonly paintIndex?: number;
  readonly phase?: VariantPhase;
  readonly phaseLabel?: string;
  readonly phaseFamily: CatalogPhaseFamily;
  readonly phaseConfidence: number;
  readonly isGammaPhase: boolean;
  readonly isVanilla: boolean;
  readonly isDoppler: boolean;
  readonly isGammaDoppler: boolean;
  readonly patternRelevant: boolean;
  readonly floatRelevant: boolean;
  readonly patternSensitivity: VariantSignalSensitivity;
  readonly floatSensitivity: VariantSignalSensitivity;
  readonly variantKey: string;
  readonly variantDisplayName: string;
  readonly confidence: number;
  readonly warnings: readonly string[];
}
