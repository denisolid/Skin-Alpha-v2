import { SourceKind } from '@prisma/client';

import type { AppConfigService } from '../src/infrastructure/config/app-config.service';
import { MarketFreshnessPolicyService } from '../src/modules/market-state/services/market-freshness-policy.service';

function createConfigServiceMock(): AppConfigService {
  return {
    backupAggregatorStaleAfterMs: 4 * 60 * 60 * 1000,
    steamSnapshotStaleAfterMs: 2 * 60 * 60 * 1000,
    steamSnapshotMaxStaleMs: 24 * 60 * 60 * 1000,
    skinportCacheTtlMs: 5 * 60 * 1000,
  } as AppConfigService;
}

describe('MarketFreshnessPolicyService', () => {
  it('keeps stale Steam snapshot rows in snapshot mode until historical fallback is used', () => {
    const service = new MarketFreshnessPolicyService(createConfigServiceMock());
    const now = new Date('2026-04-05T12:00:00.000Z');
    const observedAt = new Date('2026-04-05T09:00:00.000Z');
    const source = {
      sourceCode: 'steam-snapshot' as const,
      sourceKind: SourceKind.OFFICIAL,
      sourceMetadata: null,
    };

    const freshness = service.evaluateSourceState(source, observedAt, now);

    expect(freshness).toMatchObject({
      state: 'stale',
      usable: true,
      staleAfterMs: 2 * 60 * 60 * 1000,
      maxStaleMs: 24 * 60 * 60 * 1000,
    });
    expect(service.resolveFetchMode(source, freshness, false)).toBe('snapshot');
    expect(
      service.applyConfidencePenalty(0.9, freshness, 'snapshot'),
    ).toBeLessThan(0.9);
  });

  it('uses fallback mode only when an older historical snapshot was explicitly reused', () => {
    const service = new MarketFreshnessPolicyService(createConfigServiceMock());
    const now = new Date('2026-04-05T12:00:00.000Z');
    const observedAt = new Date('2026-04-05T09:00:00.000Z');
    const source = {
      sourceCode: 'steam-snapshot' as const,
      sourceKind: SourceKind.OFFICIAL,
      sourceMetadata: null,
    };

    const freshness = service.evaluateSourceState(source, observedAt, now);

    expect(service.resolveFetchMode(source, freshness, true)).toBe('fallback');
    expect(
      service.applyConfidencePenalty(0.9, freshness, 'fallback'),
    ).toBeLessThan(service.applyConfidencePenalty(0.9, freshness, 'snapshot'));
  });

  it('treats reference-only sources as backup data with a lower confidence ceiling', () => {
    const service = new MarketFreshnessPolicyService(createConfigServiceMock());
    const now = new Date('2026-04-05T12:00:00.000Z');
    const observedAt = new Date('2026-04-05T11:30:00.000Z');
    const source = {
      sourceCode: 'backup-aggregator' as const,
      sourceKind: SourceKind.AGGREGATOR,
      sourceMetadata: {
        role: 'reference-only',
      },
    };

    const freshness = service.evaluateSourceState(source, observedAt, now);

    expect(freshness.state).toBe('fresh');
    expect(service.resolveFetchMode(source, freshness, false)).toBe('backup');
    expect(service.applyConfidencePenalty(1, freshness, 'backup')).toBe(0.7);
  });

  it('expires sources that are beyond the maximum stale window', () => {
    const service = new MarketFreshnessPolicyService(createConfigServiceMock());
    const now = new Date('2026-04-05T12:00:00.000Z');
    const observedAt = new Date('2026-04-04T09:00:00.000Z');
    const source = {
      sourceCode: 'steam-snapshot' as const,
      sourceKind: SourceKind.OFFICIAL,
      sourceMetadata: null,
    };

    const freshness = service.evaluateSourceState(source, observedAt, now);

    expect(freshness).toMatchObject({
      state: 'expired',
      usable: false,
    });
    expect(service.applyConfidencePenalty(0.85, freshness, 'snapshot')).toBe(0);
  });
});
