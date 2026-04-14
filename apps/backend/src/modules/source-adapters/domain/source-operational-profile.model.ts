import type { SourceAdapterKey } from './source-adapter.types';

export const SOURCE_OPERATIONAL_SOURCE_KEYS = [
  'skinport',
  'csfloat',
  'dmarket',
  'waxpeer',
  'bitskins',
  'steam-snapshot',
  'backup-aggregator',
  'youpin',
  'c5game',
  'csmoney',
  'buff163',
] as const;

export type SourceOperationalSourceKey =
  (typeof SOURCE_OPERATIONAL_SOURCE_KEYS)[number];

export const SOURCE_INTEGRATION_MODELS = [
  'official-api',
  'signed-official-api',
  'official-public-api',
  'official-snapshot',
  'partner-api',
  'open-platform-api',
  'session-web',
  'reverse-engineered-session',
  'internal-aggregator',
] as const;

export type SourceIntegrationModel =
  (typeof SOURCE_INTEGRATION_MODELS)[number];

export const SOURCE_OPERATIONAL_STAGES = [
  'active',
  'limited',
  'prep',
  'disabled',
] as const;

export type SourceOperationalStage =
  (typeof SOURCE_OPERATIONAL_STAGES)[number];

export interface SourceOperationalProfileModel {
  readonly key: SourceOperationalSourceKey;
  readonly displayName: string;
  readonly integrationModel: SourceIntegrationModel;
  readonly stage: SourceOperationalStage;
  readonly riskTier: 'low' | 'medium' | 'high' | 'extreme';
  readonly proxyRequirement: 'none' | 'optional' | 'required';
  readonly sessionRequirement: 'none' | 'optional' | 'required';
  readonly accountRequirement: 'none' | 'optional' | 'required';
  readonly cookieRequirement: 'none' | 'optional' | 'required';
  readonly regionAffinity: 'global' | 'cn-mainland' | 'eu' | 'us';
  readonly overlapPriorityWeight: number;
  readonly pairBuildingWeight: number;
  readonly autoDisableEligible: boolean;
  readonly notes: readonly string[];
}

export function isSourceAdapterKey(
  value: SourceOperationalSourceKey,
): value is SourceAdapterKey {
  return value !== 'buff163';
}
