import { Inject, Injectable } from '@nestjs/common';

import type { ArchivedRawPayloadDto } from '../dto/archived-raw-payload.dto';
import type {
  CsFloatListingDetailEnvelopeDto,
  CsFloatListingDto,
  CsFloatListingsEnvelopeDto,
} from '../dto/csfloat-listing-payload.dto';
import type { NormalizedMarketListingDto } from '../dto/normalized-market-listing.dto';
import type { NormalizedSourcePayloadDto } from '../dto/normalized-source-payload.dto';
import { CsFloatCatalogLinkerService } from './csfloat-catalog-linker.service';

@Injectable()
export class CsFloatPayloadNormalizerService {
  constructor(
    @Inject(CsFloatCatalogLinkerService)
    private readonly csfloatCatalogLinkerService: CsFloatCatalogLinkerService,
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
      warnings: normalizedCollection.warnings,
    };
  }

  private async normalizeListingCollection(
    archive: ArchivedRawPayloadDto,
    listings: readonly CsFloatListingDto[],
  ): Promise<{
    readonly listings: readonly NormalizedMarketListingDto[];
    readonly warnings: readonly string[];
  }> {
    const normalizedListings: NormalizedMarketListingDto[] = [];
    const warnings: string[] = [];

    for (const listing of listings) {
      if (!this.isActiveListing(listing.state)) {
        continue;
      }

      const linkedItem = await this.csfloatCatalogLinkerService.resolveOrCreate(
        {
          marketHashName: listing.item.marketHashName,
          ...(listing.item.rarity !== undefined
            ? { rarity: listing.item.rarity }
            : {}),
          ...(listing.item.wearName ? { exterior: listing.item.wearName } : {}),
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
        },
      );

      if (
        linkedItem.status !== 'resolved' ||
        !linkedItem.canonicalItemId ||
        !linkedItem.itemVariantId
      ) {
        warnings.push(
          this.buildUnresolvedWarning(listing.item.marketHashName, linkedItem),
        );
        continue;
      }

      normalizedListings.push({
        source: archive.source,
        externalListingId: listing.id,
        sourceItemId: listing.item.assetId,
        canonicalItemId: linkedItem.canonicalItemId,
        itemVariantId: linkedItem.itemVariantId,
        title: listing.item.marketHashName,
        observedAt: archive.observedAt,
        currency: 'USD',
        priceMinor: listing.price,
        quantityAvailable: 1,
        ...(listing.item.wearName ? { condition: listing.item.wearName } : {}),
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
          rarity: listing.item.rarity ?? null,
          quality: listing.item.quality ?? null,
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
      warnings,
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
}
