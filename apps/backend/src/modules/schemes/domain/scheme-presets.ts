import { ItemCategory } from '@prisma/client';

import {
  type SchemeAlertSettingsConfig,
  type SchemeLiveOptionsConfig,
  type SchemeScopeConfig,
  type SchemeSelectionConfig,
  type SchemeThresholdsConfig,
  type SchemeValidationConfig,
  type SchemeViewConfig,
} from './scheme.model';

export interface SchemePresetDefinition {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly scope: SchemeScopeConfig;
  readonly selection: SchemeSelectionConfig;
  readonly thresholds: SchemeThresholdsConfig;
  readonly validation: SchemeValidationConfig;
  readonly view: SchemeViewConfig;
  readonly alertSettings: SchemeAlertSettingsConfig;
  readonly liveOptions: SchemeLiveOptionsConfig;
}

export const SCHEME_PRESETS: readonly SchemePresetDefinition[] = [
  {
    key: 'balanced-workspace',
    name: 'Balanced Workspace',
    description:
      'General-purpose workstation preset for multi-source opportunity scanning.',
    scope: {
      categories: [
        ItemCategory.SKIN,
        ItemCategory.KNIFE,
        ItemCategory.GLOVE,
        ItemCategory.CASE,
        ItemCategory.CAPSULE,
      ],
      tiers: ['hot', 'warm', 'cold'],
      itemTypes: [],
      itemVariantIds: [],
    },
    selection: {
      buySources: [
        'skinport',
        'csfloat',
        'waxpeer',
        'bitskins',
        'youpin',
        'c5game',
        'csmoney',
        'steam-snapshot',
      ],
      sellSources: [
        'skinport',
        'csfloat',
        'waxpeer',
        'bitskins',
        'youpin',
        'c5game',
        'csmoney',
        'steam-snapshot',
      ],
      excludedSourcePairs: [],
    },
    thresholds: {
      minExpectedNetProfit: 1.5,
      minConfidence: 0.4,
      minLiquidity: 0.3,
      minDisposition: 'candidate',
      maxRiskClass: 'high',
    },
    validation: {
      allowFallbackData: true,
      allowListedExitOnly: true,
      allowRiskyHighUpside: true,
    },
    view: {
      defaultSortBy: 'expected_profit',
      defaultSortDirection: 'desc',
      defaultPageSize: 25,
    },
    alertSettings: {
      cooldownSeconds: 3600,
      suppressStale: true,
      suppressFallback: true,
    },
    liveOptions: {
      freshOnly: false,
      maxPairsPerVariant: 32,
      newOnlyWindowSeconds: 300,
      dedupeWindowSeconds: 60,
    },
  },
  {
    key: 'strict-arbitrage',
    name: 'Strict Arbitrage',
    description:
      'Higher-confidence preset for actionable opportunities with tighter validation.',
    scope: {
      categories: [ItemCategory.SKIN, ItemCategory.KNIFE, ItemCategory.GLOVE],
      tiers: ['hot', 'warm'],
      itemTypes: [],
      itemVariantIds: [],
    },
    selection: {
      buySources: [
        'skinport',
        'csfloat',
        'waxpeer',
        'bitskins',
        'youpin',
        'c5game',
      ],
      sellSources: [
        'skinport',
        'csfloat',
        'waxpeer',
        'bitskins',
        'youpin',
        'c5game',
      ],
      excludedSourcePairs: [],
    },
    thresholds: {
      minExpectedNetProfit: 4,
      minConfidence: 0.62,
      minLiquidity: 0.5,
      minDisposition: 'near_eligible',
      maxRiskClass: 'medium',
    },
    validation: {
      allowFallbackData: false,
      allowListedExitOnly: false,
      allowRiskyHighUpside: false,
    },
    view: {
      defaultSortBy: 'confidence',
      defaultSortDirection: 'desc',
      defaultPageSize: 25,
    },
    alertSettings: {
      minExpectedNetProfit: 5,
      minConfidence: 0.68,
      cooldownSeconds: 1800,
      suppressStale: true,
      suppressFallback: true,
    },
    liveOptions: {
      freshOnly: true,
      maxPairsPerVariant: 16,
      newOnlyWindowSeconds: 180,
      dedupeWindowSeconds: 45,
    },
  },
] as const;

export const SCHEME_PRESETS_BY_KEY: ReadonlyMap<string, SchemePresetDefinition> =
  new Map(SCHEME_PRESETS.map((preset) => [preset.key, preset] as const));
