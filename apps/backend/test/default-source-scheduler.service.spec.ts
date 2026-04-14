import { DefaultSourceSchedulerService } from '../src/modules/source-adapters/infrastructure/scheduler/default-source-scheduler.service';

describe('DefaultSourceSchedulerService', () => {
  const service = new DefaultSourceSchedulerService();
  const requestedAt = new Date('2026-04-10T12:00:00.000Z');

  const adapter = {
    key: 'csfloat',
    displayName: 'CSFloat',
    category: 'marketplace',
    classification: 'PRIMARY',
    behavior: {
      canDrivePrimaryTruth: true,
      canProvideFallbackPricing: true,
      canProvideQuantitySignals: true,
      canBeUsedForPairBuilding: true,
      canBeUsedForConfirmationOnly: true,
    },
    capabilities: {
      supportedSyncModes: ['full-snapshot', 'incremental', 'market-state-only'],
      supportsRawListingSnapshots: true,
      supportsNormalizedListings: true,
      supportsNormalizedMarketState: true,
      supportsIncrementalSync: true,
      supportsFloatMetadata: true,
      supportsPatternMetadata: true,
      supportsPhaseMetadata: true,
      supportsVariantSignals: true,
      supportsRateLimitTelemetry: true,
      supportsHealthChecks: true,
      supportsFallbackRole: true,
    },
    priority: {
      tier: 'primary',
      weight: 100,
      enabled: true,
      fallback: {
        fallbackSources: ['skinport'],
        activateAfterConsecutiveFailures: 2,
        cooldownSeconds: 180,
      },
    },
  } as const;

  it('defers execution when the source is rate limited', async () => {
    const decision = await service.decide({
      adapter,
      health: {
        status: 'healthy',
        checkedAt: requestedAt,
        consecutiveFailures: 0,
      },
      rateLimitState: {
        status: 'cooldown',
        checkedAt: requestedAt,
        retryAfterSeconds: 120,
      },
      trigger: 'scheduled',
      requestedAt,
    });

    expect(decision.shouldRun).toBe(false);
    expect(decision.reason).toBe('rate-limit-cooldown');
    expect(decision.selectedFallback).toBe('skinport');
    expect(decision.scheduledAt.toISOString()).toBe(
      new Date(requestedAt.getTime() + 120_000).toISOString(),
    );
  });

  it('falls back after repeated health failures', async () => {
    const decision = await service.decide({
      adapter,
      health: {
        status: 'degraded',
        checkedAt: requestedAt,
        consecutiveFailures: 3,
        lastFailureAt: requestedAt,
      },
      rateLimitState: {
        status: 'available',
        checkedAt: requestedAt,
      },
      trigger: 'scheduled',
      requestedAt,
    });

    expect(decision.shouldRun).toBe(false);
    expect(decision.reason).toBe('health-fallback');
    expect(decision.selectedFallback).toBe('skinport');
  });
});
