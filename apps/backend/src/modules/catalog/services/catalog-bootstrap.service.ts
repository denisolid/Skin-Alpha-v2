import { Inject, Injectable } from '@nestjs/common';

import { AppLoggerService } from '../../../infrastructure/logging/app-logger.service';
import {
  CATALOG_REPOSITORY,
  type CatalogRepository,
} from '../domain/catalog.repository';
import type {
  CatalogBootstrapResultDto,
  CatalogBootstrapSeedResultDto,
  CatalogBootstrapStatus,
  CatalogBootstrapSummaryDto,
} from '../dto/catalog-bootstrap-result.dto';
import type { CatalogSourceListingInputDto } from '../dto/catalog-source-listing-input.dto';
import { CatalogMappingService } from './catalog-mapping.service';

const CONTROLLED_CS2_UNIVERSE = 'controlled-cs2-v1';
const CATALOG_BOOTSTRAP_SOURCE = 'catalog-bootstrap';
const CATALOG_BOOTSTRAP_MAPPING_SOURCE: CatalogSourceListingInputDto['source'] =
  'skinport';
type MutableCatalogBootstrapSummary = {
  -readonly [K in keyof CatalogBootstrapSummaryDto]: CatalogBootstrapSummaryDto[K];
};

const CONTROLLED_CS2_UNIVERSE_SEEDS: readonly Omit<
  CatalogSourceListingInputDto,
  'source'
>[] = [
  {
    marketHashName: 'AK-47 | Redline (Field-Tested)',
    type: 'skin',
    weapon: 'AK-47',
    skinName: 'Redline',
    exterior: 'Field-Tested',
    rarity: 'Classified',
    defIndex: 7,
    paintIndex: 282,
  },
  {
    marketHashName: 'M4A1-S | Printstream (Field-Tested)',
    type: 'skin',
    weapon: 'M4A1-S',
    skinName: 'Printstream',
    exterior: 'Field-Tested',
    rarity: 'Covert',
    defIndex: 60,
    paintIndex: 984,
  },
  {
    marketHashName: 'AWP | Asiimov (Field-Tested)',
    type: 'skin',
    weapon: 'AWP',
    skinName: 'Asiimov',
    exterior: 'Field-Tested',
    rarity: 'Covert',
    defIndex: 9,
    paintIndex: 279,
  },
  {
    marketHashName: 'Butterfly Knife | Doppler (Phase 2)',
    type: 'knife',
    weapon: 'Butterfly Knife',
    skinName: 'Doppler',
    rarity: 'Covert',
    defIndex: 515,
    paintIndex: 420,
    phaseHint: 'Phase 2',
  },
  {
    marketHashName: 'Karambit',
    type: 'knife',
    weapon: 'Karambit',
    rarity: 'Covert',
    defIndex: 507,
  },
  {
    marketHashName: 'Sport Gloves | Vice (Field-Tested)',
    type: 'glove',
    weapon: 'Sport Gloves',
    skinName: 'Vice',
    exterior: 'Field-Tested',
    rarity: 'Extraordinary',
    defIndex: 5030,
    paintIndex: 10048,
  },
  {
    marketHashName: 'Specialist Gloves | Fade (Field-Tested)',
    type: 'glove',
    weapon: 'Specialist Gloves',
    skinName: 'Fade',
    exterior: 'Field-Tested',
    rarity: 'Extraordinary',
    defIndex: 5034,
    paintIndex: 10062,
  },
  {
    marketHashName: 'Revolution Case',
    type: 'case',
    rarity: 'Base Grade',
  },
  {
    marketHashName: 'Kilowatt Case',
    type: 'case',
    rarity: 'Base Grade',
  },
  {
    marketHashName: 'Copenhagen 2024 Legends Sticker Capsule',
    type: 'capsule',
    rarity: 'Base Grade',
  },
  {
    marketHashName: 'Paris 2023 Challengers Sticker Capsule',
    type: 'capsule',
    rarity: 'Base Grade',
  },
] as const;

@Injectable()
export class CatalogBootstrapService {
  constructor(
    @Inject(AppLoggerService)
    private readonly logger: AppLoggerService,
    @Inject(CATALOG_REPOSITORY)
    private readonly catalogRepository: CatalogRepository,
    @Inject(CatalogMappingService)
    private readonly catalogMappingService: CatalogMappingService,
  ) {}

  async bootstrapControlledUniverse(): Promise<CatalogBootstrapResultDto> {
    this.logger.log(
      `Bootstrapping catalog universe "${CONTROLLED_CS2_UNIVERSE}" with ${CONTROLLED_CS2_UNIVERSE_SEEDS.length} entries.`,
      CatalogBootstrapService.name,
    );

    const seedItems = this.createSummary();
    const canonicalItems = this.createSummary();
    const itemVariants = this.createSummary();
    const warnings: string[] = [];
    const results: CatalogBootstrapSeedResultDto[] = [];

    for (const seed of CONTROLLED_CS2_UNIVERSE_SEEDS) {
      const mapping = this.catalogMappingService.mapSourceListing({
        source: CATALOG_BOOTSTRAP_MAPPING_SOURCE,
        ...seed,
      });
      const seedWarnings =
        mapping.warnings.length > 0
          ? [`${seed.marketHashName}: ${mapping.warnings.join('; ')}`]
          : [];

      warnings.push(...seedWarnings);

      if (mapping.confidence < 0.75) {
        const failureReason = `Resolved below safety threshold (${mapping.confidence}).`;
        warnings.push(`${seed.marketHashName}: ${failureReason}`);

        this.incrementSummary(seedItems, 'skipped');
        this.incrementSummary(canonicalItems, 'skipped');
        this.incrementSummary(itemVariants, 'skipped');
        results.push({
          marketHashName: seed.marketHashName,
          canonicalSlug: mapping.canonicalSlug,
          variantKey: mapping.variantKey,
          status: 'skipped',
          canonicalItem: {
            status: 'skipped',
          },
          itemVariant: {
            status: 'skipped',
          },
          warnings: seedWarnings,
          failureReason,
        });
        continue;
      }

      try {
        const persistedMapping = await this.catalogRepository.upsertResolvedMapping(
          {
            source: CATALOG_BOOTSTRAP_SOURCE,
            mapping,
          },
        );
        const seedStatus = this.resolveSeedStatus(
          persistedMapping.canonicalItemAction,
          persistedMapping.itemVariantAction,
        );

        this.incrementSummary(seedItems, seedStatus);
        this.incrementSummary(
          canonicalItems,
          persistedMapping.canonicalItemAction,
        );
        this.incrementSummary(itemVariants, persistedMapping.itemVariantAction);
        results.push({
          marketHashName: seed.marketHashName,
          canonicalSlug: mapping.canonicalSlug,
          variantKey: mapping.variantKey,
          status: seedStatus,
          canonicalItem: {
            status: persistedMapping.canonicalItemAction,
            id: persistedMapping.canonicalItemId,
          },
          itemVariant: {
            status: persistedMapping.itemVariantAction,
            id: persistedMapping.itemVariantId,
          },
          warnings: seedWarnings,
        });
      } catch (error) {
        const failureReason =
          error instanceof Error ? error.message : 'Unknown bootstrap failure.';
        warnings.push(`${seed.marketHashName}: ${failureReason}`);

        this.incrementSummary(seedItems, 'failed');
        this.incrementSummary(canonicalItems, 'failed');
        this.incrementSummary(itemVariants, 'failed');
        results.push({
          marketHashName: seed.marketHashName,
          canonicalSlug: mapping.canonicalSlug,
          variantKey: mapping.variantKey,
          status: 'failed',
          canonicalItem: {
            status: 'failed',
          },
          itemVariant: {
            status: 'failed',
          },
          warnings: seedWarnings,
          failureReason,
        });
      }
    }

    this.logger.log(
      `Catalog bootstrap "${CONTROLLED_CS2_UNIVERSE}" completed. Canonical items: ${canonicalItems.created} created, ${canonicalItems.updated} updated, ${canonicalItems.existingMatched} matched. Variants: ${itemVariants.created} created, ${itemVariants.updated} updated, ${itemVariants.existingMatched} matched.`,
      CatalogBootstrapService.name,
    );

    return {
      universe: CONTROLLED_CS2_UNIVERSE,
      seededItemCount: CONTROLLED_CS2_UNIVERSE_SEEDS.length,
      canonicalItemsCreated: canonicalItems.created,
      itemVariantsCreated: itemVariants.created,
      seedItems,
      canonicalItems,
      itemVariants,
      results,
      warnings,
    };
  }

  private createSummary(): MutableCatalogBootstrapSummary {
    return {
      existingMatched: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
    };
  }

  private incrementSummary(
    summary: MutableCatalogBootstrapSummary,
    status: CatalogBootstrapStatus,
  ): void {
    summary[status] += 1;
  }

  private resolveSeedStatus(
    canonicalItemStatus: Extract<CatalogBootstrapStatus, 'existingMatched' | 'created' | 'updated'>,
    itemVariantStatus: Extract<CatalogBootstrapStatus, 'existingMatched' | 'created' | 'updated'>,
  ): Extract<CatalogBootstrapStatus, 'existingMatched' | 'created' | 'updated'> {
    if (
      canonicalItemStatus === 'created' ||
      itemVariantStatus === 'created'
    ) {
      return 'created';
    }

    if (
      canonicalItemStatus === 'updated' ||
      itemVariantStatus === 'updated'
    ) {
      return 'updated';
    }

    return 'existingMatched';
  }
}
