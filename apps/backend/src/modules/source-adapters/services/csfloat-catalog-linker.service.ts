import { Inject, Injectable } from '@nestjs/common';

import type { CatalogResolutionDto } from '../../catalog/dto/catalog-resolution.dto';
import { CatalogService } from '../../catalog/services/catalog.service';

export interface ResolveCsFloatListingInput {
  readonly marketHashName: string;
  readonly type?: string | null;
  readonly rarity?: string | number | null;
  readonly exterior?: string | null;
  readonly isStatTrak?: boolean | null;
  readonly isSouvenir?: boolean | null;
  readonly defIndex?: number | null;
  readonly paintIndex?: number | null;
  readonly phaseHint?: string | null;
}

export interface CsFloatCatalogLinkerRunContext {
  readonly resolutionCache: Map<string, CatalogResolutionDto>;
}

interface CachedCatalogResolution {
  readonly value: CatalogResolutionDto;
  readonly expiresAtMs: number;
}

@Injectable()
export class CsFloatCatalogLinkerService {
  private static readonly CACHE_TTL_MS = 60 * 60 * 1000;

  private static readonly MAX_CACHE_ENTRIES = 50_000;

  private readonly resolutionCache = new Map<string, CachedCatalogResolution>();

  constructor(
    @Inject(CatalogService)
    private readonly catalogService: CatalogService,
  ) {}

  createRunContext(): CsFloatCatalogLinkerRunContext {
    return {
      resolutionCache: new Map<string, CatalogResolutionDto>(),
    };
  }

  async resolveOrCreate(
    input: ResolveCsFloatListingInput,
    runContext?: CsFloatCatalogLinkerRunContext,
  ): Promise<CatalogResolutionDto> {
    const [resolvedMapping] = await this.resolveOrCreateMany([input], runContext);

    if (!resolvedMapping) {
      throw new Error('CSFloat catalog linker unexpectedly returned no result.');
    }

    return resolvedMapping;
  }

  async resolveOrCreateMany(
    inputs: readonly ResolveCsFloatListingInput[],
    runContext?: CsFloatCatalogLinkerRunContext,
  ): Promise<readonly CatalogResolutionDto[]> {
    if (inputs.length === 0) {
      return [];
    }

    const uniqueInputs = new Map<string, ResolveCsFloatListingInput>();

    for (const input of inputs) {
      const cacheKey = this.buildCacheKey(input);

      if (!uniqueInputs.has(cacheKey)) {
        uniqueInputs.set(cacheKey, input);
      }
    }

    const resolvedMappings = new Map<string, CatalogResolutionDto>();
    const unresolvedInputs: ResolveCsFloatListingInput[] = [];

    for (const [cacheKey, input] of uniqueInputs.entries()) {
      const cachedResolution =
        runContext?.resolutionCache.get(cacheKey) ?? this.readFromCache(cacheKey);

      if (cachedResolution) {
        resolvedMappings.set(cacheKey, cachedResolution);
        if (runContext) {
          runContext.resolutionCache.set(cacheKey, cachedResolution);
        }
        continue;
      }

      unresolvedInputs.push(input);
    }

    if (unresolvedInputs.length > 0) {
      const persistedResolutions =
        await this.catalogService.resolveSourceListings(
          unresolvedInputs.map((input) => ({
            source: 'csfloat',
            marketHashName: input.marketHashName,
            ...(input.type ? { type: input.type } : {}),
            ...(input.rarity !== undefined && input.rarity !== null
              ? { rarity: input.rarity }
              : {}),
            ...(input.exterior ? { exterior: input.exterior } : {}),
            ...(input.isStatTrak !== undefined
              ? { isStatTrak: input.isStatTrak }
              : {}),
            ...(input.isSouvenir !== undefined
              ? { isSouvenir: input.isSouvenir }
              : {}),
            ...(input.defIndex !== undefined && input.defIndex !== null
              ? { defIndex: input.defIndex }
              : {}),
            ...(input.paintIndex !== undefined && input.paintIndex !== null
              ? { paintIndex: input.paintIndex }
              : {}),
            ...(input.phaseHint ? { phaseHint: input.phaseHint } : {}),
          })),
        );

      unresolvedInputs.forEach((input, index) => {
        const resolvedMapping = persistedResolutions[index];

        if (!resolvedMapping) {
          return;
        }

        const cacheKey = this.buildCacheKey(input);

        resolvedMappings.set(cacheKey, resolvedMapping);
        runContext?.resolutionCache.set(cacheKey, resolvedMapping);
        this.writeToCache(cacheKey, resolvedMapping);
      });
    }

    return inputs.map((input) => {
      const resolvedMapping = resolvedMappings.get(this.buildCacheKey(input));

      if (!resolvedMapping) {
        throw new Error(
          `CSFloat catalog linker failed to resolve "${input.marketHashName}".`,
        );
      }

      return resolvedMapping;
    });
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

  private writeToCache(
    cacheKey: string,
    value: CatalogResolutionDto,
  ): void {
    if (
      this.resolutionCache.size >= CsFloatCatalogLinkerService.MAX_CACHE_ENTRIES
    ) {
      const oldestKey = this.resolutionCache.keys().next().value;

      if (typeof oldestKey === 'string') {
        this.resolutionCache.delete(oldestKey);
      }
    }

    this.resolutionCache.set(cacheKey, {
      value,
      expiresAtMs: Date.now() + CsFloatCatalogLinkerService.CACHE_TTL_MS,
    });
  }

  private buildCacheKey(input: ResolveCsFloatListingInput): string {
    return JSON.stringify({
      marketHashName: input.marketHashName,
      type: input.type ?? null,
      rarity: input.rarity ?? null,
      exterior: input.exterior ?? null,
      isStatTrak: input.isStatTrak ?? null,
      isSouvenir: input.isSouvenir ?? null,
      defIndex: input.defIndex ?? null,
      paintIndex: input.paintIndex ?? null,
      phaseHint: input.phaseHint ?? null,
    });
  }
}
