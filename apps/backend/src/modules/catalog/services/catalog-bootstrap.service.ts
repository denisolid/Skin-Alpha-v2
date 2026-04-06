import { Inject, Injectable } from '@nestjs/common';

import { AppLoggerService } from '../../../infrastructure/logging/app-logger.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  CATALOG_REPOSITORY,
  type CatalogRepository,
} from '../domain/catalog.repository';
import type { CatalogBootstrapResultDto } from '../dto/catalog-bootstrap-result.dto';
import type { CatalogSourceListingInputDto } from '../dto/catalog-source-listing-input.dto';
import { CatalogMappingService } from './catalog-mapping.service';

const CONTROLLED_CS2_UNIVERSE = 'controlled-cs2-v1';
const CATALOG_BOOTSTRAP_SOURCE = 'catalog-bootstrap';
const CATALOG_BOOTSTRAP_MAPPING_SOURCE: CatalogSourceListingInputDto['source'] =
  'skinport';

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
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
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

    let canonicalItemsCreated = 0;
    let itemVariantsCreated = 0;
    const warnings: string[] = [];

    for (const seed of CONTROLLED_CS2_UNIVERSE_SEEDS) {
      const mapping = this.catalogMappingService.mapSourceListing({
        source: CATALOG_BOOTSTRAP_MAPPING_SOURCE,
        ...seed,
      });

      if (mapping.confidence < 0.75) {
        throw new Error(
          `Catalog bootstrap seed "${seed.marketHashName}" resolved below the safety threshold (${mapping.confidence}).`,
        );
      }

      const existingCanonicalItem =
        await this.prismaService.canonicalItem.findUnique({
          where: {
            slug: mapping.canonicalSlug,
          },
          select: {
            id: true,
          },
        });
      const existingItemVariant = existingCanonicalItem
        ? await this.prismaService.itemVariant.findUnique({
            where: {
              canonicalItemId_variantKey: {
                canonicalItemId: existingCanonicalItem.id,
                variantKey: mapping.variantKey,
              },
            },
            select: {
              id: true,
            },
          })
        : null;

      await this.catalogRepository.upsertResolvedMapping({
        source: CATALOG_BOOTSTRAP_SOURCE,
        mapping,
      });

      if (!existingCanonicalItem) {
        canonicalItemsCreated += 1;
      }

      if (!existingItemVariant) {
        itemVariantsCreated += 1;
      }

      if (mapping.warnings.length > 0) {
        warnings.push(`${seed.marketHashName}: ${mapping.warnings.join('; ')}`);
      }
    }

    this.logger.log(
      `Catalog bootstrap "${CONTROLLED_CS2_UNIVERSE}" completed. Created ${canonicalItemsCreated} canonical items and ${itemVariantsCreated} variants.`,
      CatalogBootstrapService.name,
    );

    return {
      universe: CONTROLLED_CS2_UNIVERSE,
      seededItemCount: CONTROLLED_CS2_UNIVERSE_SEEDS.length,
      canonicalItemsCreated,
      itemVariantsCreated,
      warnings,
    };
  }
}
