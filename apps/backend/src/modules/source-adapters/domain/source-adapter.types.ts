export const SOURCE_ADAPTER_KEYS = [
  'skinport',
  'csfloat',
  'dmarket',
  'waxpeer',
  'youpin',
  'bitskins',
  'c5game',
  'csmoney',
  'steam-snapshot',
  'backup-aggregator',
] as const;

export type SourceAdapterKey = (typeof SOURCE_ADAPTER_KEYS)[number];

export const SOURCE_SYNC_MODES = [
  'full-snapshot',
  'incremental',
  'market-state-only',
] as const;

export type SourceSyncMode = (typeof SOURCE_SYNC_MODES)[number];

export const SOURCE_SYNC_TRIGGERS = [
  'bootstrap',
  'scheduled',
  'manual',
  'recovery',
  'fallback',
] as const;

export type SourceSyncTrigger = (typeof SOURCE_SYNC_TRIGGERS)[number];

export const SOURCE_CATEGORIES = [
  'marketplace',
  'snapshot',
  'aggregator',
] as const;

export type SourceCategory = (typeof SOURCE_CATEGORIES)[number];
