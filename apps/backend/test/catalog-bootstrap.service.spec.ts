import { ItemCategory } from '@prisma/client';

import type { CatalogRepository } from '../src/modules/catalog/domain/catalog.repository';
import { CatalogBootstrapService } from '../src/modules/catalog/services/catalog-bootstrap.service';
import type { CatalogItemMappingDto } from '../src/modules/catalog/dto/catalog-item-mapping.dto';

describe('CatalogBootstrapService', () => {
  it('reports matched, created, updated, and skipped seed outcomes explicitly', async () => {
    const logger = {
      log: jest.fn(),
    };
    const catalogRepository: CatalogRepository = {
      getModuleSkeleton: jest.fn(),
      upsertResolvedMapping: jest.fn(async ({ mapping }) => {
        if (mapping.marketHashName === 'AK-47 | Redline (Field-Tested)') {
          return {
            canonicalItemId: 'canonical-created',
            itemVariantId: 'variant-created',
            category: ItemCategory.SKIN,
            canonicalItemAction: 'created' as const,
            itemVariantAction: 'created' as const,
          };
        }

        if (
          mapping.marketHashName === 'M4A1-S | Printstream (Field-Tested)'
        ) {
          return {
            canonicalItemId: 'canonical-updated',
            itemVariantId: 'variant-matched',
            category: ItemCategory.SKIN,
            canonicalItemAction: 'updated' as const,
            itemVariantAction: 'existingMatched' as const,
          };
        }

        return {
          canonicalItemId: `canonical:${mapping.canonicalSlug}`,
          itemVariantId: `variant:${mapping.variantKey}`,
          category: mapping.category,
          canonicalItemAction: 'existingMatched' as const,
          itemVariantAction: 'existingMatched' as const,
        };
      }),
      upsertResolvedMappings: jest.fn(),
    };
    const catalogMappingService = {
      mapSourceListing: jest.fn((input: {
        readonly marketHashName: string;
      }): CatalogItemMappingDto => {
        if (input.marketHashName === 'AWP | Asiimov (Field-Tested)') {
          return {
            marketHashName: input.marketHashName,
            canonicalSlug: 'awp-asiimov',
            canonicalDisplayName: 'AWP | Asiimov',
            category: ItemCategory.SKIN,
            type: 'skin',
            weapon: 'AWP',
            skinName: 'Asiimov',
            exterior: 'Field-Tested',
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
            confidence: 0.5,
            warnings: [],
          };
        }

        return {
          marketHashName: input.marketHashName,
          canonicalSlug: input.marketHashName
            .toLowerCase()
            .replace(/[^a-z0-9]+/gu, '-')
            .replace(/^-+|-+$/gu, ''),
          canonicalDisplayName: input.marketHashName,
          category: ItemCategory.SKIN,
          type: 'skin',
          weapon: 'AK-47',
          skinName: 'Demo',
          exterior: 'Field-Tested',
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
        };
      }),
    };
    const service = new CatalogBootstrapService(
      logger as never,
      catalogRepository,
      catalogMappingService as never,
    );

    const result = await service.bootstrapControlledUniverse();

    expect(result.seededItemCount).toBe(11);
    expect(result.canonicalItemsCreated).toBe(1);
    expect(result.itemVariantsCreated).toBe(1);
    expect(result.seedItems).toEqual({
      existingMatched: 8,
      created: 1,
      updated: 1,
      skipped: 1,
      failed: 0,
    });
    expect(result.canonicalItems).toEqual({
      existingMatched: 8,
      created: 1,
      updated: 1,
      skipped: 1,
      failed: 0,
    });
    expect(result.itemVariants).toEqual({
      existingMatched: 9,
      created: 1,
      updated: 0,
      skipped: 1,
      failed: 0,
    });
    expect(result.results).toHaveLength(11);
    expect(
      result.results.find(
        (entry) => entry.marketHashName === 'AK-47 | Redline (Field-Tested)',
      ),
    ).toMatchObject({
      status: 'created',
      canonicalItem: { status: 'created' },
      itemVariant: { status: 'created' },
    });
    expect(
      result.results.find(
        (entry) =>
          entry.marketHashName === 'M4A1-S | Printstream (Field-Tested)',
      ),
    ).toMatchObject({
      status: 'updated',
      canonicalItem: { status: 'updated' },
      itemVariant: { status: 'existingMatched' },
    });
    expect(
      result.results.find(
        (entry) => entry.marketHashName === 'AWP | Asiimov (Field-Tested)',
      ),
    ).toMatchObject({
      status: 'skipped',
      canonicalItem: { status: 'skipped' },
      itemVariant: { status: 'skipped' },
      failureReason: expect.stringContaining('Resolved below safety threshold'),
    });
    expect(catalogRepository.upsertResolvedMapping).toHaveBeenCalledTimes(10);
  });
});
