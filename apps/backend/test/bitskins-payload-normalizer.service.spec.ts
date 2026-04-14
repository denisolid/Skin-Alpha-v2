import { ItemCategory } from '@prisma/client';

import type { ArchivedRawPayloadDto } from '../src/modules/source-adapters/dto/archived-raw-payload.dto';
import { BitSkinsPayloadNormalizerService } from '../src/modules/source-adapters/services/bitskins-payload-normalizer.service';

describe('BitSkinsPayloadNormalizerService', () => {
  it('filters the aggregate snapshot down to requested targets and emits zero-state rows for missing targets', async () => {
    const service = new BitSkinsPayloadNormalizerService({
      createRunContext: jest.fn(() => ({
        resolutionCache: new Map(),
      })),
      resolveOrCreateMany: jest.fn(
        async (
          inputs: readonly { readonly marketHashName: string }[],
        ) =>
          inputs.map((input) => ({
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
              floatRelevant: false,
              variantKey: 'default',
              variantDisplayName: input.marketHashName,
              confidence: 1,
              warnings: [],
            },
            canonicalItemId: `canonical:${input.marketHashName}`,
            itemVariantId: `variant:${input.marketHashName}`,
            category: ItemCategory.SKIN,
          })),
      ),
    } as never);
    const archive: ArchivedRawPayloadDto = {
      id: 'archive-1',
      sourceId: 'source-1',
      source: 'bitskins',
      endpointName: 'bitskins-listings',
      observedAt: new Date('2026-04-12T18:23:33.929Z'),
      entityType: 'SOURCE_SYNC',
      entityId: 'bitskins-listings:archive-1',
      payload: {
        list: [
          {
            skin_id: 101,
            name: 'AK-47 | Slate (Field-Tested)',
            price_min: 1550,
            price_max: 2440,
            price_avg: 1830,
            quantity: 14,
          },
        ],
      },
      payloadHash: 'hash-1',
      requestMeta: {
        targets: [
          {
            canonicalItemId: 'canonical-ak',
            itemVariantId: 'variant-ak',
            marketHashName: 'AK-47 | Slate (Field-Tested)',
          },
          {
            canonicalItemId: 'canonical-missing',
            itemVariantId: 'variant-missing',
            marketHashName: 'M4A1-S | Printstream (Field-Tested)',
          },
        ],
      },
      fetchedAt: new Date('2026-04-12T18:23:34.000Z'),
      archivedAt: new Date('2026-04-12T18:23:36.000Z'),
    };

    const result = await service.normalize(archive);

    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]).toMatchObject({
      externalListingId: 'bitskins:101',
      title: 'AK-47 | Slate (Field-Tested)',
      priceMinor: 1550,
      quantityAvailable: 14,
    });
    expect(result.marketStates).toHaveLength(2);
    expect(result.marketStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemVariantId: 'variant:AK-47 | Slate (Field-Tested)',
          listingCount: 14,
          lowestAskMinor: 1550,
          average24hMinor: 1830,
        }),
        expect.objectContaining({
          itemVariantId: 'variant-missing',
          listingCount: 0,
          confidence: 0,
        }),
      ]),
    );
    expect(result.warnings).toEqual([
      expect.stringContaining('BitSkins snapshot did not contain 1 targeted rows'),
    ]);
  });
});
