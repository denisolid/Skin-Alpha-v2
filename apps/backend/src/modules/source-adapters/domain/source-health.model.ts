export const SOURCE_HEALTH_STATUSES = [
  'unknown',
  'healthy',
  'degraded',
  'down',
] as const;

export type SourceHealthStatus = (typeof SOURCE_HEALTH_STATUSES)[number];

export interface SourceHealthModel {
  readonly status: SourceHealthStatus;
  readonly checkedAt: Date;
  readonly consecutiveFailures: number;
  readonly lastSuccessfulSyncAt?: Date;
  readonly lastFailureAt?: Date;
  readonly latencyMs?: number;
  readonly detail?: string;
}

export function createUnknownSourceHealth(
  checkedAt: Date = new Date(),
): SourceHealthModel {
  return {
    status: 'unknown',
    checkedAt,
    consecutiveFailures: 0,
  };
}
