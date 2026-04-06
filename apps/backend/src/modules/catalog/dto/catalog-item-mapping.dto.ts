import type { ItemCategory, VariantPhase } from '@prisma/client';

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
  readonly isGammaPhase: boolean;
  readonly isVanilla: boolean;
  readonly isDoppler: boolean;
  readonly isGammaDoppler: boolean;
  readonly patternRelevant: boolean;
  readonly floatRelevant: boolean;
  readonly variantKey: string;
  readonly variantDisplayName: string;
  readonly confidence: number;
  readonly warnings: readonly string[];
}
