import { Inject, Injectable } from '@nestjs/common';

import type { CatalogResolutionDto } from '../../catalog/dto/catalog-resolution.dto';
import {
  CatalogService,
  type CatalogResolvedSourceListingResult,
} from '../../catalog/services/catalog.service';

interface CachedCatalogResolution {
  readonly value: CatalogResolutionDto;
  readonly expiresAtMs: number;
}

export interface ResolveSkinportListingInput {
  readonly marketHashName: string;
  readonly version?: string | null;
}

export interface SkinportCatalogLinkerRunContext {
  readonly resolutionCache: Map<string, CatalogResolutionDto>;
}

export interface SkinportCatalogBatchResolutionStats {
  readonly batchSize: number;
  readonly uniqueListingKeys: number;
  readonly cacheHits: number;
  readonly resolvedCount: number;
  readonly unresolvedCount: number;
  readonly createdCount: number;
  readonly reusedCount: number;
  readonly updatedCount: number;
}

export interface SkinportCatalogBatchResolutionResult {
  readonly resolutions: ReadonlyMap<string, CatalogResolutionDto>;
  readonly stats: SkinportCatalogBatchResolutionStats;
}

@Injectable()
export class SkinportCatalogLinkerService {
  private static readonly CACHE_TTL_MS = 60 * 60 * 1000;

  private static readonly MAX_CACHE_ENTRIES = 50_000;

  private readonly resolutionCache = new Map<string, CachedCatalogResolution>();

  constructor(
    @Inject(CatalogService)
    private readonly catalogService: CatalogService,
  ) {}

  createRunContext(): SkinportCatalogLinkerRunContext {
    return {
      resolutionCache: new Map<string, CatalogResolutionDto>(),
    };
  }

  async resolveOrCreate(
    marketHashName: string,
    version?: string | null,
  ): Promise<CatalogResolutionDto> {
    const batchResult = await this.resolveOrCreateMany([
      {
        marketHashName,
        ...(version !== undefined ? { version } : {}),
      },
    ]);
    const cacheKey = this.buildCacheKey(marketHashName, version);
    const resolvedMapping = batchResult.resolutions.get(cacheKey);

    if (!resolvedMapping) {
      throw new Error(
        `Skinport catalog linker failed to resolve "${marketHashName}"${version ? ` (${version})` : ''}.`,
      );
    }

    return resolvedMapping;
  }

  async resolveOrCreateMany(
    inputs: readonly ResolveSkinportListingInput[],
    runContext?: SkinportCatalogLinkerRunContext,
  ): Promise<SkinportCatalogBatchResolutionResult> {
    const uniqueInputs = new Map<string, ResolveSkinportListingInput>();
    const resolvedMappings = new Map<string, CatalogResolutionDto>();
    let cacheHits = 0;

    for (const input of inputs) {
      const cacheKey = this.buildCacheKey(input.marketHashName, input.version);

      if (!uniqueInputs.has(cacheKey)) {
        uniqueInputs.set(cacheKey, input);
      }
    }

    const unresolvedInputs: ResolveSkinportListingInput[] = [];

    for (const [cacheKey, input] of uniqueInputs.entries()) {
      const cachedResolution =
        runContext?.resolutionCache.get(cacheKey) ?? this.readFromCache(cacheKey);

      if (cachedResolution) {
        resolvedMappings.set(cacheKey, cachedResolution);
        if (runContext) {
          runContext.resolutionCache.set(cacheKey, cachedResolution);
        }
        cacheHits += 1;
        continue;
      }

      unresolvedInputs.push(input);
    }

    let createdCount = 0;
    let reusedCount = 0;
    let updatedCount = 0;

    if (unresolvedInputs.length > 0) {
      const persistedResults =
        await this.catalogService.resolveSourceListingsWithPersistence(
          unresolvedInputs.map((input) => ({
            source: 'skinport',
            marketHashName: input.marketHashName,
            ...(input.version ? { phaseHint: input.version } : {}),
          })),
        );

      persistedResults.forEach((result, index) => {
        const input = unresolvedInputs[index];

        if (!input) {
          return;
        }

        const cacheKey = this.buildCacheKey(input.marketHashName, input.version);

        resolvedMappings.set(cacheKey, result.resolution);
        runContext?.resolutionCache.set(cacheKey, result.resolution);
        this.writeToCache(cacheKey, result.resolution);
        this.updateResolutionStats(result, {
          incrementCreated: () => {
            createdCount += 1;
          },
          incrementReused: () => {
            reusedCount += 1;
          },
          incrementUpdated: () => {
            updatedCount += 1;
          },
        });
      });
    }

    let resolvedCount = 0;
    let unresolvedCount = 0;

    for (const resolution of resolvedMappings.values()) {
      if (resolution.status === 'resolved') {
        resolvedCount += 1;
      } else {
        unresolvedCount += 1;
      }
    }

    return {
      resolutions: resolvedMappings,
      stats: {
        batchSize: inputs.length,
        uniqueListingKeys: uniqueInputs.size,
        cacheHits,
        resolvedCount,
        unresolvedCount,
        createdCount,
        reusedCount,
        updatedCount,
      },
    };
  }

  private buildCacheKey(
    marketHashName: string,
    version?: string | null,
  ): string {
    return `${marketHashName}::${version ?? ''}`;
  }

  private readFromCache(cacheKey: string): CatalogResolutionDto | null {
    const cachedResolution = this.resolutionCache.get(cacheKey);

    if (!cachedResolution) {
      return null;
    }

    if (cachedResolution.expiresAtMs <= Date.now()) {
      this.resolutionCache.delete(cacheKey);
      return null;
    }

    return cachedResolution.value;
  }

  private updateResolutionStats(
    result: CatalogResolvedSourceListingResult,
    counters: {
      readonly incrementCreated: () => void;
      readonly incrementReused: () => void;
      readonly incrementUpdated: () => void;
    },
  ): void {
    if (result.resolution.status !== 'resolved' || !result.persistedMapping) {
      return;
    }

    if (
      result.persistedMapping.canonicalItemAction === 'created' ||
      result.persistedMapping.itemVariantAction === 'created'
    ) {
      counters.incrementCreated();
      return;
    }

    if (
      result.persistedMapping.canonicalItemAction === 'updated' ||
      result.persistedMapping.itemVariantAction === 'updated'
    ) {
      counters.incrementUpdated();
      return;
    }

    counters.incrementReused();
  }

  private writeToCache(
    cacheKey: string,
    value: CatalogResolutionDto,
  ): void {
    if (
      this.resolutionCache.size >=
      SkinportCatalogLinkerService.MAX_CACHE_ENTRIES
    ) {
      const oldestKey = this.resolutionCache.keys().next().value;

      if (typeof oldestKey === 'string') {
        this.resolutionCache.delete(oldestKey);
      }
    }

    this.resolutionCache.set(cacheKey, {
      value,
      expiresAtMs: Date.now() + SkinportCatalogLinkerService.CACHE_TTL_MS,
    });
  }
}
