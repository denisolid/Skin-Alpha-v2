import { Prisma, SourceKind } from '@prisma/client';

import type {
  MarketReadRepository,
  MarketSnapshotRecord,
  MarketStateSourceRecord,
} from '../src/modules/market-state/domain/market-read.repository';
import { MarketSnapshotService } from '../src/modules/market-state/services/market-snapshot.service';

describe('MarketSnapshotService', () => {
  it('ignores zero-quantity history entries when selecting fallback snapshots', () => {
    const freshnessService = {
      evaluateSourceState: jest.fn().mockReturnValue({
        state: 'fresh',
        lagMs: 60_000,
        staleAfterMs: 600_000,
        maxStaleMs: 7_200_000,
        usable: true,
      }),
    };
    const repository: MarketReadRepository = {
      findVariantRecord: jest.fn(),
      findVariantRecords: jest.fn(),
      findVariantRecordsByCanonicalItem: jest.fn(),
      findVariantSnapshotHistory: jest.fn(),
      findVariantSnapshotHistories: jest.fn(),
    };
    const service = new MarketSnapshotService(
      repository,
      freshnessService as never,
    );
    const sourceState: MarketStateSourceRecord = {
      sourceId: 'source-1',
      sourceCode: 'csfloat',
      sourceName: 'CSFloat',
      sourceKind: SourceKind.MARKETPLACE,
      sourceMetadata: null,
      representativeListing: null,
      latestSnapshotId: 'latest-empty',
      currencyCode: 'USD',
      observedAt: new Date('2026-04-11T14:00:00.000Z'),
      lastSyncedAt: new Date('2026-04-11T14:00:00.000Z'),
      latestSnapshot: null,
    };
    const zeroQuantitySnapshot: MarketSnapshotRecord = {
      snapshotId: 'older-empty',
      sourceId: 'source-1',
      sourceCode: 'csfloat',
      sourceName: 'CSFloat',
      sourceKind: SourceKind.MARKETPLACE,
      sourceMetadata: null,
      currencyCode: 'USD',
      listingCount: 0,
      observedAt: new Date('2026-04-11T13:30:00.000Z'),
    };
    const usableSnapshot: MarketSnapshotRecord = {
      snapshotId: 'older-ask',
      sourceId: 'source-1',
      sourceCode: 'csfloat',
      sourceName: 'CSFloat',
      sourceKind: SourceKind.MARKETPLACE,
      sourceMetadata: null,
      currencyCode: 'USD',
      lowestAskGross: new Prisma.Decimal('153.12'),
      listingCount: 12,
      observedAt: new Date('2026-04-11T13:00:00.000Z'),
    };

    const fallback = service.selectHistoricalFallback(
      sourceState,
      [zeroQuantitySnapshot, usableSnapshot],
      new Date('2026-04-11T14:05:00.000Z'),
    );

    expect(fallback?.snapshot.snapshotId).toBe('older-ask');
  });
});
