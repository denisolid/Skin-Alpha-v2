import { Inject, Injectable, Optional } from '@nestjs/common';

import { CatalogAliasNormalizationService } from '../../catalog/services/catalog-alias-normalization.service';
import { DMARKET_MARKET_ITEMS_ENDPOINT_NAME } from '../domain/dmarket.constants';
import type { ArchivedRawPayloadDto } from '../dto/archived-raw-payload.dto';
import type {
  DMarketMarketItemDto,
  DMarketMarketItemsEnvelopeDto,
} from '../dto/dmarket-market-item.dto';
import type { NormalizedMarketListingDto } from '../dto/normalized-market-listing.dto';
import type { NormalizedSourcePayloadDto } from '../dto/normalized-source-payload.dto';
import {
  DMarketCatalogLinkerService,
  type ResolveDMarketListingInput,
} from './dmarket-catalog-linker.service';

@Injectable()
export class DMarketPayloadNormalizerService {
  constructor(
    @Inject(DMarketCatalogLinkerService)
    private readonly dmarketCatalogLinkerService: DMarketCatalogLinkerService,
    @Optional()
    @Inject(CatalogAliasNormalizationService)
    private readonly aliasNormalizationService: CatalogAliasNormalizationService = new CatalogAliasNormalizationService(),
  ) {}

  async normalize(
    archive: ArchivedRawPayloadDto,
  ): Promise<NormalizedSourcePayloadDto> {
    if (archive.endpointName !== DMARKET_MARKET_ITEMS_ENDPOINT_NAME) {
      return {
        rawPayloadArchiveId: archive.id,
        source: archive.source,
        endpointName: archive.endpointName,
        observedAt: archive.observedAt,
        payloadHash: archive.payloadHash,
        listings: [],
        marketStates: [],
        warnings: [`Unsupported DMarket endpoint ${archive.endpointName}.`],
      };
    }

    const payload = this.isEnvelope(archive.payload) ? archive.payload : null;

    if (!payload) {
      return {
        rawPayloadArchiveId: archive.id,
        source: archive.source,
        endpointName: archive.endpointName,
        observedAt: archive.observedAt,
        payloadHash: archive.payloadHash,
        listings: [],
        marketStates: [],
        warnings: ['Invalid DMarket market-items payload.'],
      };
    }

    const runContext = this.dmarketCatalogLinkerService.createRunContext();
    const resolutionInputs = payload.objects.map((item) =>
      this.buildResolutionInput(item),
    );
    const resolutions =
      await this.dmarketCatalogLinkerService.resolveOrCreateMany(
        resolutionInputs,
        runContext,
      );
    const normalizedListings: NormalizedMarketListingDto[] = [];
    const mappingSignals: Array<
      NonNullable<NormalizedSourcePayloadDto['mappingSignals']>[number]
    > = [];
    const warnings: string[] = [];

    payload.objects.forEach((item, index) => {
      const resolution = resolutions[index];
      const resolutionInput = resolutionInputs[index];
      const title = item.title
        ? this.aliasNormalizationService.normalizeMarketHashName(item.title)
        : undefined;
      const externalListingId = item.extra?.offerId ?? item.itemId;
      const sourceItemId = item.itemId ?? item.classId ?? externalListingId;

      if (!resolution || !resolutionInput || !title || !externalListingId || !sourceItemId) {
        return;
      }

      if (
        resolution.status !== 'resolved' ||
        !resolution.canonicalItemId ||
        !resolution.itemVariantId
      ) {
        warnings.push(this.buildUnresolvedWarning(title, resolution));
        mappingSignals.push({
          kind: 'listing',
          sourceItemId,
          title,
          observedAt: archive.observedAt,
          resolutionNote: this.buildUnresolvedWarning(title, resolution),
          variantHints: this.buildMappingHints(resolutionInput),
          metadata: {
            resolutionReason: resolution.reason ?? null,
            warnings: [...resolution.warnings],
          },
        });
        return;
      }

      const priceMinor = this.toMinorAmount(
        item.price?.USD ?? item.instantPrice?.USD ?? item.suggestedPrice?.USD,
      );

      if (priceMinor === undefined || priceMinor <= 0) {
        warnings.push(`DMarket listing "${title}" is missing a usable USD price.`);
        return;
      }

      normalizedListings.push({
        source: archive.source,
        externalListingId,
        sourceItemId,
        canonicalItemId: resolution.canonicalItemId,
        itemVariantId: resolution.itemVariantId,
        title,
        observedAt: archive.observedAt,
        currency: 'USD',
        priceMinor,
        quantityAvailable: Math.max(1, item.amount ?? 1),
        ...(resolutionInput.exterior ? { condition: resolutionInput.exterior } : {}),
        ...(resolutionInput.phaseHint ? { phase: resolutionInput.phaseHint } : {}),
        ...(item.extra?.paintSeed !== undefined
          ? { paintSeed: item.extra.paintSeed }
          : {}),
        ...(item.extra?.floatValue !== undefined
          ? { wearFloat: item.extra.floatValue }
          : {}),
        isStatTrak: resolutionInput.isStatTrak ?? false,
        isSouvenir: resolutionInput.isSouvenir ?? false,
        metadata: {
          classId: item.classId ?? null,
          gameId: item.gameId ?? item.extra?.gameId ?? null,
          image: item.image ?? null,
          inMarket: item.inMarket ?? null,
          instantPriceUsd: item.instantPrice?.USD ?? null,
          itemId: item.itemId ?? null,
          ownerDetails: item.ownerDetails ?? null,
          recommendedPrice: item.recommendedPrice ?? null,
          slug: item.slug ?? null,
          status: item.status ?? null,
          suggestedPriceUsd: item.suggestedPrice?.USD ?? null,
          type: item.type ?? item.extra?.type ?? null,
          extra: item.extra ?? null,
        },
      });
    });

    return {
      rawPayloadArchiveId: archive.id,
      source: archive.source,
      endpointName: archive.endpointName,
      observedAt: archive.observedAt,
      payloadHash: archive.payloadHash,
      listings: normalizedListings,
      marketStates: [],
      ...(mappingSignals.length > 0 ? { mappingSignals } : {}),
      warnings,
    };
  }

  private buildResolutionInput(
    item: DMarketMarketItemDto,
  ): ResolveDMarketListingInput {
    const title = this.aliasNormalizationService.normalizeMarketHashName(
      item.title ?? item.extra?.name ?? 'unknown',
    );
    const exterior =
      this.aliasNormalizationService.normalizeExterior(item.extra?.exterior) ??
      this.aliasNormalizationService.extractExteriorFromTitle(title);
    const phaseHint = this.resolvePhaseHint([
      item.extra?.phase,
      item.extra?.quality,
      item.title,
      item.extra?.name,
    ]);

    return {
      marketHashName: title,
      ...(item.extra?.itemType ? { type: item.extra.itemType } : {}),
      ...(item.extra?.rarity ? { rarity: item.extra.rarity } : {}),
      ...(exterior ? { exterior } : {}),
      isStatTrak: this.detectStatTrak(title, item.extra),
      isSouvenir: this.detectSouvenir(title, item.extra),
      ...(phaseHint ? { phaseHint } : {}),
    };
  }

  private isEnvelope(value: unknown): value is DMarketMarketItemsEnvelopeDto {
    return (
      typeof value === 'object' &&
      value !== null &&
      'objects' in value &&
      Array.isArray((value as { objects?: unknown[] }).objects)
    );
  }

  private normalizeExterior(value?: string): string | undefined {
    return this.aliasNormalizationService.normalizeExterior(value);
  }

  private resolvePhaseHint(
    values: readonly (string | undefined)[],
  ): string | undefined {
    for (const value of values) {
      const phaseHint =
        this.aliasNormalizationService.normalizePhaseHint(value);

      if (phaseHint) {
        return phaseHint;
      }
    }

    return undefined;
  }

  private detectStatTrak(title: string, extra?: DMarketMarketItemDto['extra']): boolean {
    if (/^StatTrak/iu.test(this.aliasNormalizationService.stripStarPrefix(title))) {
      return true;
    }

    return extra?.quality?.toLowerCase().includes('stattrak') ?? false;
  }

  private detectSouvenir(title: string, extra?: DMarketMarketItemDto['extra']): boolean {
    if (/^Souvenir/iu.test(this.aliasNormalizationService.stripStarPrefix(title))) {
      return true;
    }

    return extra?.quality?.toLowerCase().includes('souvenir') ?? false;
  }

  private toMinorAmount(value?: string): number | undefined {
    if (!value) {
      return undefined;
    }

    const normalized = value.trim();

    if (normalized.length === 0) {
      return undefined;
    }

    if (normalized.includes('.')) {
      const parsed = Number(normalized);

      return Number.isFinite(parsed) ? Math.round(parsed * 100) : undefined;
    }

    const parsed = Number(normalized);

    return Number.isFinite(parsed) ? Math.round(parsed) : undefined;
  }

  private buildUnresolvedWarning(
    title: string,
    resolution: {
      readonly confidence: number;
      readonly reason?: string;
      readonly warnings: readonly string[];
    },
  ): string {
    return `DMarket catalog resolver left "${title}" unresolved at confidence ${resolution.confidence.toFixed(2)}${resolution.reason ? ` (${resolution.reason})` : ''}${resolution.warnings.length > 0 ? `: ${resolution.warnings.join('; ')}` : '.'}`;
  }

  private buildMappingHints(
    input: ResolveDMarketListingInput,
  ): Record<string, unknown> {
    return {
      marketHashName: input.marketHashName,
      type: input.type ?? null,
      rarity: input.rarity ?? null,
      exterior: input.exterior ?? null,
      isStatTrak: input.isStatTrak ?? null,
      isSouvenir: input.isSouvenir ?? null,
      phaseHint: input.phaseHint ?? null,
    };
  }
}
