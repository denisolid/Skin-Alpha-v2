import type { ItemCategory, SchemeStatus } from '@prisma/client';

import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';
import type { OpportunityEngineRiskClass } from '../../opportunities/domain/opportunity-engine.model';
import type { ScannerItemTier } from '../../opportunities/domain/item-tier.model';

export const SCHEME_SORT_FIELDS = [
  'expected_profit',
  'confidence',
  'freshness',
  'liquidity',
] as const;

export type SchemeSortField = (typeof SCHEME_SORT_FIELDS)[number];

export const SCHEME_SORT_DIRECTIONS = ['asc', 'desc'] as const;

export type SchemeSortDirection = (typeof SCHEME_SORT_DIRECTIONS)[number];

export const SCHEME_DISPOSITION_FLOORS = [
  'candidate',
  'near_eligible',
  'eligible',
  'risky_high_upside',
] as const;

export type SchemeDispositionFloor = (typeof SCHEME_DISPOSITION_FLOORS)[number];

export interface SchemeScopeConfig {
  readonly categories: readonly ItemCategory[];
  readonly tiers: readonly ScannerItemTier[];
  readonly itemTypes: readonly string[];
  readonly itemVariantIds: readonly string[];
}

export interface SchemeSelectionConfig {
  readonly buySources: readonly SourceAdapterKey[];
  readonly sellSources: readonly SourceAdapterKey[];
  readonly excludedSourcePairs: readonly string[];
}

export interface SchemeThresholdsConfig {
  readonly minExpectedNetProfit: number;
  readonly minConfidence: number;
  readonly minLiquidity: number;
  readonly minBuyCost?: number;
  readonly maxBuyCost?: number;
  readonly minDisposition: SchemeDispositionFloor;
  readonly maxRiskClass?: OpportunityEngineRiskClass;
}

export interface SchemeValidationConfig {
  readonly allowFallbackData: boolean;
  readonly allowListedExitOnly: boolean;
  readonly allowRiskyHighUpside: boolean;
}

export interface SchemeViewConfig {
  readonly defaultSortBy: SchemeSortField;
  readonly defaultSortDirection: SchemeSortDirection;
  readonly defaultPageSize: number;
}

export interface SchemeAlertSettingsConfig {
  readonly minExpectedNetProfit?: number;
  readonly minConfidence?: number;
  readonly cooldownSeconds: number;
  readonly suppressStale: boolean;
  readonly suppressFallback: boolean;
}

export interface SchemeLiveOptionsConfig {
  readonly freshOnly: boolean;
  readonly maxPairsPerVariant: number;
  readonly newOnlyWindowSeconds: number;
  readonly dedupeWindowSeconds: number;
}

export interface SchemeRecord {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: SchemeStatus;
  readonly revision: number;
  readonly originPresetKey: string | null;
  readonly feedEnabled: boolean;
  readonly liveEnabled: boolean;
  readonly alertsEnabled: boolean;
  readonly priority: number;
  readonly configHash: string;
  readonly scopeJson: unknown;
  readonly selectionJson: unknown;
  readonly thresholdsJson: unknown;
  readonly validationJson: unknown;
  readonly viewJson: unknown;
  readonly alertJson: unknown;
  readonly liveJson: unknown;
  readonly activatedAt: Date | null;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CompiledScheme {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: SchemeStatus;
  readonly revision: number;
  readonly originPresetKey: string | null;
  readonly feedEnabled: boolean;
  readonly liveEnabled: boolean;
  readonly alertsEnabled: boolean;
  readonly priority: number;
  readonly configHash: string;
  readonly scope: SchemeScopeConfig;
  readonly selection: SchemeSelectionConfig;
  readonly thresholds: SchemeThresholdsConfig;
  readonly validation: SchemeValidationConfig;
  readonly view: SchemeViewConfig;
  readonly alertSettings: SchemeAlertSettingsConfig;
  readonly liveOptions: SchemeLiveOptionsConfig;
  readonly activatedAt: Date | null;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NormalizedSchemeConfig {
  readonly scope: SchemeScopeConfig;
  readonly selection: SchemeSelectionConfig;
  readonly thresholds: SchemeThresholdsConfig;
  readonly validation: SchemeValidationConfig;
  readonly view: SchemeViewConfig;
  readonly alertSettings: SchemeAlertSettingsConfig;
  readonly liveOptions: SchemeLiveOptionsConfig;
  readonly configHash: string;
}
