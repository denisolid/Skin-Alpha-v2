import { Inject, Injectable } from '@nestjs/common';

import type { CatalogUseCase } from '../application/catalog.use-case';
import {
  CATALOG_REPOSITORY,
  type CatalogRepository,
} from '../domain/catalog.repository';
import type { CatalogResolutionDto } from '../dto/catalog-resolution.dto';
import type { CatalogSourceListingInputDto } from '../dto/catalog-source-listing-input.dto';
import { CatalogStatusDto } from '../dto/catalog-status.dto';
import { CatalogMappingService } from './catalog-mapping.service';

@Injectable()
export class CatalogService implements CatalogUseCase {
  constructor(
    @Inject(CATALOG_REPOSITORY)
    private readonly catalogRepository: CatalogRepository,
    @Inject(CatalogMappingService)
    private readonly catalogMappingService: CatalogMappingService,
  ) {}

  getStatus(): CatalogStatusDto {
    return new CatalogStatusDto(this.catalogRepository.getModuleSkeleton());
  }

  async resolveSourceListing(
    input: CatalogSourceListingInputDto,
  ): Promise<CatalogResolutionDto> {
    const mapping = this.catalogMappingService.mapSourceListing(input);

    if (
      mapping.confidence < 0.75 ||
      mapping.canonicalSlug.length === 0 ||
      mapping.canonicalDisplayName.length === 0
    ) {
      return {
        status: 'unresolved',
        confidence: mapping.confidence,
        reason:
          mapping.canonicalDisplayName.length === 0
            ? 'catalog_missing_display_name'
            : 'catalog_low_confidence_match',
        warnings: mapping.warnings,
        mapping,
      };
    }

    const persistedMapping = await this.catalogRepository.upsertResolvedMapping(
      {
        source: input.source,
        mapping,
      },
    );

    return {
      status: 'resolved',
      confidence: mapping.confidence,
      warnings: mapping.warnings,
      mapping,
      canonicalItemId: persistedMapping.canonicalItemId,
      itemVariantId: persistedMapping.itemVariantId,
      category: persistedMapping.category,
    };
  }
}
