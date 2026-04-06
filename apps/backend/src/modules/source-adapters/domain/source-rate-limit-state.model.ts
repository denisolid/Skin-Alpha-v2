export const SOURCE_RATE_LIMIT_STATUSES = [
  'unknown',
  'available',
  'limited',
  'cooldown',
  'blocked',
] as const;

export type SourceRateLimitStatus = (typeof SOURCE_RATE_LIMIT_STATUSES)[number];

export interface SourceRateLimitStateModel {
  readonly status: SourceRateLimitStatus;
  readonly checkedAt: Date;
  readonly windowLimit?: number;
  readonly windowRemaining?: number;
  readonly concurrencyLimit?: number;
  readonly concurrencyInUse?: number;
  readonly retryAfterSeconds?: number;
  readonly resetsAt?: Date;
}

export function createUnknownSourceRateLimitState(
  checkedAt: Date = new Date(),
): SourceRateLimitStateModel {
  return {
    status: 'unknown',
    checkedAt,
  };
}
