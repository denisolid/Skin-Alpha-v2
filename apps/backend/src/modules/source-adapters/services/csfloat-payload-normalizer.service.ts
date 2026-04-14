import { Inject, Injectable, Optional } from '@nestjs/common';

import { CatalogAliasNormalizationService } from '../../catalog/services/catalog-alias-normalization.service';
import type { ArchivedRawPayloadDto } from '../dto/archived-raw-payload.dto';
import type {
  CsFloatListingDetailEnvelopeDto,
  CsFloatListingDto,
  CsFloatListingsEnvelopeDto,
} from '../dto/csfloat-listing-payload.dto';
import type { NormalizedMarketListingDto } from '../dto/normalized-market-listing.dto';
import type { NormalizedSourcePayloadDto } from '../dto/normalized-source-payload.dto';
import {
  CsFloatCatalogLinkerService,
  type ResolveCsFloatListingInput,
} from './csfloat-catalog-linker.service';

@Injectable()
export class CsFloatPayloadNormalizerService {
  constructor(
    @Inject(CsFloatCatalogLinkerService)
    private readonly csfloatCatalogLinkerService: CsFloatCatalogLinkerService,
    @Optional()
    @Inject(CatalogAliasNormalizationService)
    private readonly aliasNormalizationService: CatalogAliasNormalizationService = new CatalogAliasNormalizationService(),
  ) {}

  async normalize(
    archive: ArchivedRawPayloadDto,
  ): Promise<NormalizedSourcePayloadDto> {
    if (archive.endpointName === 'csfloat-listings') {
      return this.normalizeListings(archive);
    }

    if (archive.endpointName === 'csfloat-listing-detail') {
      return this.normalizeListingDetail(archive);
    }

    return {
      rawPayloadArchiveId: archive.id,
      source: archive.source,
      endpointName: archive.endpointName,
      observedAt: archive.observedAt,
      payloadHash: archive.payloadHash,
      listings: [],
      marketStates: [],
      warnings: [`Unsupported CSFloat endpoint ${archive.endpointName}.`],
    };
  }

  private async normalizeListings(
    archive: ArchivedRawPayloadDto,
  ): Promise<NormalizedSourcePayloadDto> {
    const payload = this.isListingsEnvelope(archive.payload)
      ? archive.payload
      : null;

    if (!payload) {
      return this.emptyPayload(archive, 'Invalid CSFloat listings payload.');
    }

    const normalizedCollection = await this.normalizeListingCollection(
      archive,
      payload.listings,
    );

    return {
      rawPayloadArchiveId: archive.id,
      source: archive.source,
      endpointName: archive.endpointName,
      observedAt: archive.observedAt,
      payloadHash: archive.payloadHash,
      listings: normalizedCollection.listings,
      marketStates: [],
      ...(normalizedCollection.mappingSignals
        ? { mappingSignals: normalizedCollection.mappingSignals }
        : {}),
      warnings: normalizedCollection.warnings,
    };
  }

  private async normalizeListingDetail(
    archive: ArchivedRawPayloadDto,
  ): Promise<NormalizedSourcePayloadDto> {
    const payload = this.isListingDetailEnvelope(archive.payload)
      ? archive.payload
      : null;

    if (!payload) {
      return this.emptyPayload(
        archive,
        'Invalid CSFloat listing detail payload.',
      );
    }

    const normalizedCollection = await this.normalizeListingCollection(
      archive,
      [payload.listing],
    );

    return {
      rawPayloadArchiveId: archive.id,
      source: archive.source,
      endpointName: archive.endpointName,
      observedAt: archive.observedAt,
      payloadHash: archive.payloadHash,
      listings: normalizedCollection.listings,
      marketStates: [],
      ...(normalizedCollection.mappingSignals
        ? { mappingSignals: normalizedCollection.mappingSignals }
        : {}),
      warnings: normalizedCollection.warnings,
    };
  }

  private async normalizeListingCollection(
    archive: ArchivedRawPayloadDto,
    listings: readonly CsFloatListingDto[],
  ): Promise<{
    readonly listings: readonly NormalizedMarketListingDto[];
    readonly mappingSignals?: NonNullable<
      NormalizedSourcePayloadDto['mappingSignals']
    >;
    readonly warnings: readonly string[];
  }> {
    const normalizedListings: NormalizedMarketListingDto[] = [];
    const mappingSignals: Array<
      NonNullable<NormalizedSourcePayloadDto['mappingSignals']>[number]
    > = [];
    const warnings: string[] = [];
    const activeListings = listings.filter((listing) =>
      this.isActiveListing(listing.state),
    );
    const runContext = this.csfloatCatalogLinkerService.createRunContext();
    const resolutionInputs = activeListings.map((listing) =>
      this.buildResolutionInput(listing),
    );
    const resolutions = await this.csfloatCatalogLinkerService.resolveOrCreateMany(
      resolutionInputs,
      runContext,
    );

    for (const [index, listing] of activeListings.entries()) {
      const linkedItem = resolutions[index];
      const resolutionInput = resolutionInputs[index];
      const normalizedTitle = this.aliasNormalizationService.normalizeMarketHashName(
        listing.item.marketHashName,
      );

      if (!linkedItem || !resolutionInput) {
        continue;
      }

      if (
        linkedItem.status !== 'resolved' ||
        !linkedItem.canonicalItemId ||
        !linkedItem.itemVariantId
      ) {
        warnings.push(
          this.buildUnresolvedWarning(normalizedTitle, linkedItem),
        );
        mappingSignals.push({
          kind: 'listing',
          sourceItemId: listing.item.assetId,
          title: normalizedTitle,
          observedAt: archive.observedAt,
          resolutionNote: this.buildUnresolvedWarning(normalizedTitle, linkedItem),
          variantHints: this.buildMappingHints(resolutionInput),
          metadata: {
            resolutionReason: linkedItem.reason ?? null,
            warnings: [...linkedItem.warnings],
          },
        });
        continue;
      }

      const phaseHint = resolutionInput.phaseHint ?? undefined;
      const condition = resolutionInput.exterior ?? undefined;

      normalizedListings.push({
        source: archive.source,
        externalListingId: listing.id,
        sourceItemId: listing.item.assetId,
        canonicalItemId: linkedItem.canonicalItemId,
        itemVariantId: linkedItem.itemVariantId,
        title: normalizedTitle,
        observedAt: archive.observedAt,
        currency: 'USD',
        priceMinor: listing.price,
        quantityAvailable: 1,
        ...(condition ? { condition } : {}),
        ...(phaseHint ? { phase: phaseHint } : {}),
        ...(listing.item.paintSeed !== undefined
          ? { paintSeed: listing.item.paintSeed }
          : {}),
        ...(listing.item.floatValue !== undefined
          ? { wearFloat: listing.item.floatValue }
          : {}),
        isStatTrak: listing.item.isStatTrak ?? linkedItem.mapping.stattrak,
        isSouvenir: listing.item.isSouvenir ?? linkedItem.mapping.souvenir,
        metadata: {
          type: listing.type ?? null,
          state: listing.state ?? null,
          inspectLink: listing.item.inspectLink ?? null,
          iconUrl: listing.item.iconUrl ?? null,
          collection: listing.item.collection ?? null,
          itemName: listing.item.itemName ?? null,
          marketHashName: normalizedTitle,
          rarity: listing.item.rarity ?? null,
          quality: listing.item.quality ?? null,
          phaseHint: phaseHint ?? null,
          tradable: listing.item.tradable ?? null,
          defIndex: listing.item.defIndex ?? null,
          paintIndex: listing.item.paintIndex ?? null,
          scm: listing.item.scm ?? null,
          stickers:
            listing.item.stickers?.map((sticker) => ({
              stickerId: sticker.stickerId ?? null,
              slot: sticker.slot ?? null,
              wear: sticker.wear ?? null,
              name: sticker.name ?? null,
              iconUrl: sticker.iconUrl ?? null,
              scm: sticker.scm ?? null,
            })) ?? [],
          seller: listing.seller
            ? {
                id: listing.seller.id ?? null,
                steamId: listing.seller.steamId ?? null,
                username: listing.seller.username ?? null,
                avatarUrl: listing.seller.avatarUrl ?? null,
                online: listing.seller.online ?? null,
                stallPublic: listing.seller.stallPublic ?? null,
                statistics: listing.seller.statistics ?? null,
              }
            : null,
          createdAt: listing.createdAt ?? null,
          minOfferPrice: listing.minOfferPrice ?? null,
          maxOfferDiscount: listing.maxOfferDiscount ?? null,
          watchers: listing.watchers ?? null,
        },
      });
    }

    return {
      listings: normalizedListings,
      ...(mappingSignals.length > 0 ? { mappingSignals } : {}),
      warnings,
    };
  }

  private buildResolutionInput(
    listing: CsFloatListingDto,
  ): ResolveCsFloatListingInput {
    const exterior =
      this.aliasNormalizationService.normalizeExterior(listing.item.wearName) ??
      this.aliasNormalizationService.extractExteriorFromTitle(
        listing.item.marketHashName,
      );
    const phaseHint = this.resolvePhaseHint([
      listing.item.itemName,
      listing.item.marketHashName,
    ]);

    return {
      marketHashName: this.aliasNormalizationService.normalizeMarketHashName(
        listing.item.marketHashName,
      ),
      ...(listing.type ? { type: listing.type } : {}),
      ...(listing.item.rarity !== undefined ? { rarity: listing.item.rarity } : {}),
      ...(exterior ? { exterior } : {}),
      ...(listing.item.isStatTrak !== undefined
        ? { isStatTrak: listing.item.isStatTrak }
        : {}),
      ...(listing.item.isSouvenir !== undefined
        ? { isSouvenir: listing.item.isSouvenir }
        : {}),
      ...(listing.item.defIndex !== undefined
        ? { defIndex: listing.item.defIndex }
        : {}),
      ...(listing.item.paintIndex !== undefined
        ? { paintIndex: listing.item.paintIndex }
        : {}),
      ...(phaseHint ? { phaseHint } : {}),
    };
  }

  private emptyPayload(
    archive: ArchivedRawPayloadDto,
    warning: string,
  ): NormalizedSourcePayloadDto {
    return {
      rawPayloadArchiveId: archive.id,
      source: archive.source,
      endpointName: archive.endpointName,
      observedAt: archive.observedAt,
      payloadHash: archive.payloadHash,
      listings: [],
      marketStates: [],
      warnings: [warning],
    };
  }

  private isListingsEnvelope(
    value: unknown,
  ): value is CsFloatListingsEnvelopeDto {
    return (
      typeof value === 'object' &&
      value !== null &&
      'listings' in value &&
      Array.isArray((value as { listings?: unknown[] }).listings)
    );
  }

  private isListingDetailEnvelope(
    value: unknown,
  ): value is CsFloatListingDetailEnvelopeDto {
    return typeof value === 'object' && value !== null && 'listing' in value;
  }

  private isActiveListing(state: string | undefined): boolean {
    if (!state) {
      return true;
    }

    return /listed|active/i.test(state);
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

  private buildUnresolvedWarning(
    marketHashName: string,
    resolution: {
      readonly confidence: number;
      readonly reason?: string;
      readonly warnings: readonly string[];
    },
  ): string {
    return `CSFloat catalog resolver left "${marketHashName}" unresolved at confidence ${resolution.confidence.toFixed(2)}${resolution.reason ? ` (${resolution.reason})` : ''}${resolution.warnings.length > 0 ? `: ${resolution.warnings.join('; ')}` : '.'}`;
  }

  private buildMappingHints(
    input: ResolveCsFloatListingInput,
  ): Record<string, unknown> {
    return {
      marketHashName: input.marketHashName,
      type: input.type ?? null,
      rarity: input.rarity ?? null,
      exterior: input.exterior ?? null,
      isStatTrak: input.isStatTrak ?? null,
      isSouvenir: input.isSouvenir ?? null,
      defIndex: input.defIndex ?? null,
      paintIndex: input.paintIndex ?? null,
      phaseHint: input.phaseHint ?? null,
    };
  }
}
