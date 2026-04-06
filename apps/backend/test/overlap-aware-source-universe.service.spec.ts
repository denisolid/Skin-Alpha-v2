import { OverlapAwareSourceUniverseService } from '../src/modules/source-adapters/services/overlap-aware-source-universe.service';
import type { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import type { SourceRecordService } from '../src/modules/source-adapters/services/source-record.service';
import type { ManagedMarketNamingService } from '../src/modules/source-adapters/services/managed-market-naming.service';

describe('OverlapAwareSourceUniverseService', () => {
  it('treats BitSkins as a core overlap source for scanner expansion', async () => {
    const prismaService = {
      itemVariant: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'variant-bitskins-csfloat',
            variantKey: 'factory-new',
            displayName: 'Factory New',
            updatedAt: new Date('2026-04-06T11:00:00.000Z'),
            metadata: {},
            canonicalItem: {
              id: 'canonical-1',
              displayName: 'AK-47 | Fire Serpent',
            },
            marketStates: [
              {
                sourceId: 'source-bitskins',
                observedAt: new Date('2026-04-06T11:40:00.000Z'),
                source: {
                  code: 'bitskins',
                  metadata: {},
                },
              },
              {
                sourceId: 'source-csfloat',
                observedAt: new Date('2026-04-06T11:39:00.000Z'),
                source: {
                  code: 'csfloat',
                  metadata: {},
                },
              },
            ],
            sourceListings: [],
          },
          {
            id: 'variant-steam-backup',
            variantKey: 'factory-new',
            displayName: 'Factory New',
            updatedAt: new Date('2026-04-06T10:00:00.000Z'),
            metadata: {},
            canonicalItem: {
              id: 'canonical-2',
              displayName: 'AK-47 | Vulcan',
            },
            marketStates: [
              {
                sourceId: 'source-steam',
                observedAt: new Date('2026-04-06T11:20:00.000Z'),
                source: {
                  code: 'steam-snapshot',
                  metadata: {},
                },
              },
              {
                sourceId: 'source-backup',
                observedAt: new Date('2026-04-06T11:18:00.000Z'),
                source: {
                  code: 'backup-aggregator',
                  metadata: {},
                },
              },
            ],
            sourceListings: [],
          },
        ]),
      },
    } as unknown as PrismaService;
    const sourceRecordService = {
      resolveByKey: jest.fn().mockResolvedValue({
        id: 'source-youpin',
      }),
    } as unknown as SourceRecordService;
    const managedMarketNamingService = {
      buildMarketHashName: jest
        .fn()
        .mockImplementation(
          (input: {
            canonicalDisplayName: string;
            variantDisplayName: string;
          }) => `${input.canonicalDisplayName} (${input.variantDisplayName})`,
        ),
    } as unknown as ManagedMarketNamingService;
    const service = new OverlapAwareSourceUniverseService(
      prismaService,
      sourceRecordService,
      managedMarketNamingService,
    );

    const batches = await service.selectPriorityBatches({
      source: 'youpin',
      batchBudget: 1,
      batchSize: 5,
      staleAfterMs: 15 * 60 * 1000,
      force: true,
    });

    expect(batches).toHaveLength(1);
    expect(batches[0]?.targets[0]).toMatchObject({
      itemVariantId: 'variant-bitskins-csfloat',
      priorityReason: 'cross-market-overlap-anchor',
      existingSourceCount: 2,
      overlapSourceCodes: ['bitskins', 'csfloat'],
    });
  });
});
