import { Inject, Injectable } from '@nestjs/common';

import type { CatalogUseCase } from '../application/catalog.use-case';
import {
  CATALOG_REPOSITORY,
  type CatalogRepository,
  type PersistCatalogMappingInput,
  type PersistedCatalogMapping,
} from '../domain/catalog.repository';
import type { CatalogResolutionDto } from '../dto/catalog-resolution.dto';
import type { CatalogSourceListingInputDto } from '../dto/catalog-source-listing-input.dto';
import { CatalogStatusDto } from '../dto/catalog-status.dto';
import { CatalogMappingService } from './catalog-mapping.service';

export interface CatalogResolvedSourceListingResult {
  readonly resolution: CatalogResolutionDto;
  readonly persistedMapping?: PersistedCatalogMapping;
}

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
    const [result] = await this.resolveSourceListingsWithPersistence([input]);

    if (!result) {
      throw new Error('Catalog resolution unexpectedly returned no result.');
    }

    return result.resolution;
  }

  async resolveSourceListings(
    inputs: readonly CatalogSourceListingInputDto[],
  ): Promise<readonly CatalogResolutionDto[]> {
    const results = await this.resolveSourceListingsWithPersistence(inputs);

    return results.map((result) => result.resolution);
  }

  async resolveSourceListingsWithPersistence(
    inputs: readonly CatalogSourceListingInputDto[],
  ): Promise<readonly CatalogResolvedSourceListingResult[]> {
    if (inputs.length === 0) {
      return [];
    }

    const persistedInputs: PersistCatalogMappingInput[] = [];
    const results = new Array<CatalogResolvedSourceListingResult>(inputs.length);

    inputs.forEach((input, index) => {
      const mapping = this.catalogMappingService.mapSourceListing(input);

      if (
        mapping.confidence < 0.75 ||
        mapping.canonicalSlug.length === 0 ||
        mapping.canonicalDisplayName.length === 0
      ) {
        results[index] = {
          resolution: {
            status: 'unresolved',
            confidence: mapping.confidence,
            reason:
              mapping.canonicalDisplayName.length === 0
                ? 'catalog_missing_display_name'
                : 'catalog_low_confidence_match',
            warnings: mapping.warnings,
            mapping,
          } satisfies CatalogResolutionDto,
        };
        return;
      }

      persistedInputs.push({
        source: input.source,
        mapping,
      });
    });
    const persistedMappings =
      await this.catalogRepository.upsertResolvedMappings(
        persistedInputs,
      );
    let persistedIndex = 0;

    inputs.forEach((input, index) => {
      if (results[index]) {
        return;
      }

      const persistedInput = persistedInputs[persistedIndex];
      const persistedMapping = persistedMappings[persistedIndex];

      persistedIndex += 1;
      if (!persistedInput || !persistedMapping) {
        throw new Error(
          `Catalog repository returned fewer persisted mappings than expected for ${input.source}:${input.marketHashName}.`,
        );
      }

      results[index] = {
        resolution: {
          status: 'resolved',
          confidence: persistedInput.mapping.confidence,
          warnings: persistedInput.mapping.warnings,
          mapping: persistedInput.mapping,
          canonicalItemId: persistedMapping.canonicalItemId,
          itemVariantId: persistedMapping.itemVariantId,
          category: persistedMapping.category,
        },
        persistedMapping,
      } satisfies CatalogResolvedSourceListingResult;
    });

    return results;
  }
}
