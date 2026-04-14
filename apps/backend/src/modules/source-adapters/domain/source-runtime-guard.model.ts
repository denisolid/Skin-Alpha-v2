import type { SourceAdapterKey } from './source-adapter.types';

export const SOURCE_RUNTIME_GUARD_MODES = [
  'active',
  'degraded',
  'cooldown',
  'disabled',
] as const;

export type SourceRuntimeGuardMode =
  (typeof SOURCE_RUNTIME_GUARD_MODES)[number];

export interface SourceRuntimeGuardState {
  readonly source: SourceAdapterKey;
  readonly mode: SourceRuntimeGuardMode;
  readonly checkedAt: Date;
  readonly expiresAt?: Date;
  readonly reason?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}
