import type { SourceAdapterKey } from './source-adapter.types';

export const SOURCE_PRIORITY_TIERS = [
  'primary',
  'secondary',
  'backup',
] as const;

export type SourcePriorityTier = (typeof SOURCE_PRIORITY_TIERS)[number];

export interface SourceFallbackPolicy {
  readonly fallbackSources: readonly SourceAdapterKey[];
  readonly activateAfterConsecutiveFailures: number;
  readonly cooldownSeconds: number;
}

export interface SourcePriorityModel {
  readonly tier: SourcePriorityTier;
  readonly weight: number;
  readonly enabled: boolean;
  readonly fallback: SourceFallbackPolicy;
}
