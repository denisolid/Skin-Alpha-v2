import { SourceKind } from '@prisma/client';

import type { MarketFreshnessPolicyService } from '../src/modules/market-state/services/market-freshness-policy.service';
import { MarketSnapshotService } from '../src/modules/market-state/services/market-snapshot.service';
import type {
  MarketSnapshotRecord,
  MarketStateRepository,
  MarketStateSourceRecord,
} from '../src/modules/market-state/domain/market-state.repository';

function createSourceState(): MarketStateSourceRecord {
  return {
    sourceId: 'source-1',
    sourceCode: 'steam-snapshot',
    sourceName: 'Steam Snapshot',
    sourceKind: SourceKind.OFFICIAL,
    sourceMetadata: null,
    latestSnapshotId: 'snapshot-current',
    currencyCode: 'USD',
    lowestAskGross: null,
    highestBidGross: null,
    listingCount: null,
    observedAt: new Date('2026-04-05T12:00:00.000Z'),
    lastSyncedAt: new Date('2026-04-05T12:00:00.000Z'),
    confidence: null,
    latestSnapshot: null,
  };
}

function createSnapshotRecord(
  snapshotId: string,
  overrides: Partial<MarketSnapshotRecord> = {},
): MarketSnapshotRecord {
  return {
    snapshotId,
    sourceId: 'source-1',
    sourceCode: 'steam-snapshot',
    sourceName: 'Steam Snapshot',
    sourceKind: SourceKind.OFFICIAL,
    sourceMetadata: null,
    currencyCode: 'USD',
    lowestAskGross: null,
    highestBidGross: null,
    listingCount: null,
    observedAt: new Date('2026-04-05T10:00:00.000Z'),
    confidence: null,
    rawPayloadArchiveId: null,
    ...overrides,
  };
}

describe('MarketSnapshotService', () => {
  function createService(
    evaluateUsable: (snapshot: MarketSnapshotRecord) => boolean,
  ): MarketSnapshotService {
    const repository = {} as MarketStateRepository;
    const marketFreshnessPolicyService = {
      evaluateSourceState: jest.fn((snapshot: MarketSnapshotRecord) => ({
        state: evaluateUsable(snapshot) ? 'fresh' : 'expired',
        lagMs: 0,
        staleAfterMs: 60_000,
        maxStaleMs: 120_000,
        usable: evaluateUsable(snapshot),
      })),
    } as unknown as MarketFreshnessPolicyService;

    return new MarketSnapshotService(repository, marketFreshnessPolicyService);
  }

  it('selects the first usable historical snapshot with a market signal', () => {
    const service = createService(
      (snapshot) => snapshot.snapshotId === 'snapshot-usable',
    );
    const sourceState = createSourceState();
    const snapshotHistory = [
      createSnapshotRecord('snapshot-current', {
        lowestAskGross: {
          toString: () => '120.00',
        },
      }),
      createSnapshotRecord('snapshot-empty'),
      createSnapshotRecord('snapshot-usable', {
        lowestAskGross: {
          toString: () => '118.50',
        },
        listingCount: 3,
      }),
    ];

    const fallback = service.selectHistoricalFallback(
      sourceState,
      snapshotHistory,
      new Date('2026-04-05T12:00:00.000Z'),
    );

    expect(fallback?.snapshot.snapshotId).toBe('snapshot-usable');
  });

  it('returns null when no usable historical snapshot exists', () => {
    const service = createService(() => false);
    const sourceState = createSourceState();
    const snapshotHistory = [
      createSnapshotRecord('snapshot-current', {
        lowestAskGross: {
          toString: () => '120.00',
        },
      }),
      createSnapshotRecord('snapshot-without-signal'),
    ];

    const fallback = service.selectHistoricalFallback(
      sourceState,
      snapshotHistory,
      new Date('2026-04-05T12:00:00.000Z'),
    );

    expect(fallback).toBeNull();
  });
});
