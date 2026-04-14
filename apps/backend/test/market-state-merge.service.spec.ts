import { ItemCategory, SourceKind } from '@prisma/client';

import type { MarketReadRepository } from '../src/modules/market-state/domain/market-read.repository';
import { MarketStateMergeService } from '../src/modules/market-state/services/market-state-merge.service';

describe('MarketStateMergeService', () => {
  it('batches snapshot history lookups when resolving multiple variant matrices', async () => {
    const marketSnapshotService = {
      getVariantSnapshotHistoryRecordMap: jest.fn().mockResolvedValue(
        new Map([
          ['variant-1', []],
          ['variant-2', []],
        ]),
      ),
      selectHistoricalFallback: jest.fn().mockReturnValue(null),
    };
    const repository: MarketReadRepository = {
      findVariantRecord: jest.fn(),
      findVariantRecords: jest.fn().mockResolvedValue([
        createVariantRecord('variant-1'),
        createVariantRecord('variant-2'),
      ]),
      findVariantRecordsByCanonicalItem: jest.fn(),
      findVariantSnapshotHistory: jest.fn(),
      findVariantSnapshotHistories: jest.fn(),
    };
    const service = new MarketStateMergeService(
      repository,
      {
        evaluateSourceState: jest.fn().mockReturnValue({
          state: 'fresh',
          lagMs: 0,
          staleAfterMs: 600_000,
          maxStaleMs: 7_200_000,
          usable: true,
        }),
        resolveFetchMode: jest.fn().mockReturnValue('live'),
        applyConfidencePenalty: jest
          .fn()
          .mockImplementation((confidence: number) => confidence),
      } as never,
      marketSnapshotService as never,
      {
        analyze: jest.fn().mockReturnValue({
          summary: {
            state: 'insufficient-data',
            comparedSourceCount: 0,
            usableSourceCount: 0,
          },
          rowDetails: new Map(),
        }),
        resolveConfidenceMultiplier: jest.fn().mockReturnValue(1),
      } as never,
      {
        resolveLinks: jest.fn().mockReturnValue({}),
      } as never,
    );

    const matrices = await service.getVariantMatrices(['variant-1', 'variant-2']);

    expect(matrices).toHaveLength(2);
    expect(repository.findVariantRecords).toHaveBeenCalledWith([
      'variant-1',
      'variant-2',
    ]);
    expect(marketSnapshotService.getVariantSnapshotHistoryRecordMap).toHaveBeenCalledWith(
      ['variant-1', 'variant-2'],
      50,
    );
  });

  it('prefers the refreshed projected state timestamp over an older latest snapshot timestamp', async () => {
    const repository: MarketReadRepository = {
      findVariantRecord: jest.fn(),
      findVariantRecords: jest.fn().mockResolvedValue([
        createVariantRecord('variant-1', {
          observedAt: new Date('2026-04-12T10:00:00.000Z'),
          latestSnapshotObservedAt: new Date('2026-04-12T06:00:00.000Z'),
        }),
      ]),
      findVariantRecordsByCanonicalItem: jest.fn(),
      findVariantSnapshotHistory: jest.fn(),
      findVariantSnapshotHistories: jest.fn(),
    };
    const freshnessPolicy = {
      evaluateSourceState: jest.fn((source, observedAt: Date) => ({
        state:
          observedAt.getTime() === new Date('2026-04-12T10:00:00.000Z').getTime()
            ? 'fresh'
            : 'expired',
        lagMs: 0,
        staleAfterMs: 600_000,
        maxStaleMs: 7_200_000,
        usable:
          observedAt.getTime() === new Date('2026-04-12T10:00:00.000Z').getTime(),
      })),
      resolveFetchMode: jest.fn().mockReturnValue('live'),
      applyConfidencePenalty: jest
        .fn()
        .mockImplementation((confidence: number) => confidence),
    };
    const service = new MarketStateMergeService(
      repository,
      freshnessPolicy as never,
      {
        getVariantSnapshotHistoryRecordMap: jest.fn().mockResolvedValue(new Map()),
        selectHistoricalFallback: jest.fn().mockReturnValue(null),
      } as never,
      {
        analyze: jest.fn().mockReturnValue({
          summary: {
            state: 'insufficient-data',
            comparedSourceCount: 0,
            usableSourceCount: 0,
          },
          rowDetails: new Map(),
        }),
        resolveConfidenceMultiplier: jest.fn().mockReturnValue(1),
      } as never,
      {
        resolveLinks: jest.fn().mockReturnValue({}),
      } as never,
    );

    const matrix = await service.getVariantMatrix('variant-1', {
      allowHistoricalFallback: false,
    });

    expect(matrix.rows[0]?.observedAt).toEqual(
      new Date('2026-04-12T10:00:00.000Z'),
    );
    expect(matrix.rows[0]?.freshness.usable).toBe(true);
  });
});

function createVariantRecord(
  itemVariantId: string,
  overrides?: {
    readonly observedAt?: Date;
    readonly latestSnapshotObservedAt?: Date;
  },
) {
  return {
    canonicalItemId: 'canonical-1',
    canonicalDisplayName: 'AK-47 | Slate',
    category: ItemCategory.SKIN,
    itemVariantId,
    variantKey: 'field-tested',
    variantDisplayName: 'Field-Tested',
    variantMetadata: null,
    marketStates: [
      {
        sourceId: `source:${itemVariantId}`,
        sourceCode: 'skinport',
        sourceName: 'Skinport',
        sourceKind: SourceKind.MARKETPLACE,
        sourceMetadata: null,
        representativeListing: null,
        latestSnapshotId: overrides?.latestSnapshotObservedAt ? 'snapshot-1' : null,
        currencyCode: 'USD',
        observedAt:
          overrides?.observedAt ?? new Date('2026-04-11T18:23:33.929Z'),
        lastSyncedAt: new Date('2026-04-11T18:23:33.929Z'),
        confidence: null,
        latestSnapshot: overrides?.latestSnapshotObservedAt
          ? {
              id: 'snapshot-1',
              rawPayloadArchiveId: null,
              currencyCode: 'USD',
              lowestAskGross: null,
              highestBidGross: null,
              confidence: null,
              listingCount: 5,
              saleCount24h: null,
              observedAt: overrides.latestSnapshotObservedAt,
              sourceKind: SourceKind.MARKETPLACE,
              sourceCode: 'skinport',
              sourceMetadata: null,
            }
          : null,
      },
    ],
  };
}
