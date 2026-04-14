import { ItemCategory } from '@prisma/client';

import type { ArchivedRawPayloadDto } from '../src/modules/source-adapters/dto/archived-raw-payload.dto';
import type { SkinportItemSnapshotDto } from '../src/modules/source-adapters/dto/skinport-item-snapshot.dto';
import { SkinportPayloadNormalizerService } from '../src/modules/source-adapters/services/skinport-payload-normalizer.service';

describe('SkinportPayloadNormalizerService', () => {
  it('normalizes large item snapshots in chunks with batch catalog resolution instrumentation', async () => {
    const logger = {
      log: jest.fn(),
    };
    const createRunContext = jest.fn(() => ({
      resolutionCache: new Map(),
    }));
    const resolveOrCreateMany = jest.fn(
      async (
        inputs: readonly { readonly marketHashName: string }[],
      ) => ({
        resolutions: new Map(
          inputs.map((input) => [
            `${input.marketHashName}::`,
            {
              status: 'resolved' as const,
              confidence: 1,
              warnings: [],
              mapping: {
                marketHashName: input.marketHashName,
                canonicalSlug: input.marketHashName
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/gu, '-')
                  .replace(/^-+|-+$/gu, ''),
                canonicalDisplayName: input.marketHashName,
                category: ItemCategory.SKIN,
                type: 'skin',
                stattrak: false,
                souvenir: false,
                isGammaPhase: false,
                isVanilla: false,
                isDoppler: false,
                isGammaDoppler: false,
                patternRelevant: false,
                floatRelevant: true,
                variantKey: 'field-tested',
                variantDisplayName: 'Field-Tested',
                confidence: 1,
                warnings: [],
              },
              canonicalItemId: `canonical:${input.marketHashName}`,
              itemVariantId: `variant:${input.marketHashName}`,
              category: ItemCategory.SKIN,
            },
          ]),
        ),
        stats: {
          batchSize: inputs.length,
          uniqueListingKeys: inputs.length,
          cacheHits: 0,
          resolvedCount: inputs.length,
          unresolvedCount: 0,
          createdCount: 1,
          reusedCount: Math.max(0, inputs.length - 1),
          updatedCount: 0,
        },
      }),
    );
    const service = new SkinportPayloadNormalizerService(
      logger as never,
      {
        createRunContext,
        resolveOrCreateMany,
      } as never,
    );
    const payload = Array.from({ length: 1_001 }, (_, index) =>
      createSnapshotItem(index),
    );
    const archive: ArchivedRawPayloadDto = {
      id: 'archive-1',
      sourceId: 'source-1',
      source: 'skinport',
      endpointName: 'skinport-items-snapshot',
      observedAt: new Date('2026-04-11T18:23:33.929Z'),
      entityType: 'SOURCE_SYNC',
      entityId: 'skinport-items-snapshot:archive-1',
      payload,
      payloadHash: 'hash-1',
      fetchedAt: new Date('2026-04-11T18:23:34.000Z'),
      archivedAt: new Date('2026-04-11T18:23:36.000Z'),
    };

    const result = await service.normalize(archive);

    expect(result.listings).toHaveLength(1_001);
    expect(result.marketStates).toHaveLength(1_001);
    expect(createRunContext).toHaveBeenCalledTimes(1);
    expect(resolveOrCreateMany).toHaveBeenCalledTimes(3);
    expect(resolveOrCreateMany.mock.calls.map(([input]) => input.length)).toEqual([
      500,
      500,
      1,
    ]);
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('chunk=1/3'),
      SkinportPayloadNormalizerService.name,
    );
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('batchSize=1001'),
      SkinportPayloadNormalizerService.name,
    );
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('uniqueListingKeys=1001'),
      SkinportPayloadNormalizerService.name,
    );
  });
});

function createSnapshotItem(index: number): SkinportItemSnapshotDto {
  return {
    market_hash_name: `AK-47 | Slate (${index})`,
    currency: 'USD',
    suggested_price: 12.34,
    item_page: `https://skinport.com/item/${index}`,
    market_page: `https://skinport.com/market/${index}`,
    min_price: 12.34,
    max_price: 16.45,
    mean_price: 13.56,
    median_price: 13.11,
    quantity: 5,
    created_at: 1_710_000_000,
    updated_at: 1_710_000_100,
  };
}
