import { ListingStatus, Prisma } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { AppLoggerService } from '../../../infrastructure/logging/app-logger.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CatalogAliasNormalizationService } from '../../catalog/services/catalog-alias-normalization.service';
import type { SourceAdapterKey } from '../domain/source-adapter.types';
import type { NormalizedListingStorageResultDto } from '../dto/normalized-listing-storage-result.dto';
import type { NormalizedSourcePayloadDto } from '../dto/normalized-source-payload.dto';
import { SourceRecordService } from './source-record.service';

@Injectable()
export class SourceListingStorageService {
  constructor(
    @Inject(AppLoggerService)
    private readonly logger: AppLoggerService,
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(CatalogAliasNormalizationService)
    private readonly aliasNormalizationService: CatalogAliasNormalizationService,
    @Inject(SourceRecordService)
    private readonly sourceRecordService: SourceRecordService,
  ) {}

  async storeNormalizedListings(
    input: NormalizedSourcePayloadDto,
  ): Promise<NormalizedListingStorageResultDto> {
    const source = await this.sourceRecordService.resolveByKey(input.source);
    const sourceListingIds: string[] = [];
    const storedListings: Array<
      NormalizedListingStorageResultDto['storedListings'][number]
    > = [];
    let skippedCount = 0;

    for (const listing of input.listings) {
      if (!listing.canonicalItemId || !listing.itemVariantId) {
        skippedCount += 1;
        continue;
      }

      const normalizedTitle = this.normalizeTitle(listing.title);

      const storedListing = await this.prismaService.sourceListing.upsert({
        where: {
          sourceId_externalListingId: {
            sourceId: source.id,
            externalListingId: listing.externalListingId,
          },
        },
        create: {
          sourceId: source.id,
          externalListingId: listing.externalListingId,
          sourceItemId: listing.sourceItemId,
          canonicalItemId: listing.canonicalItemId,
          itemVariantId: listing.itemVariantId,
          title: normalizedTitle,
          normalizedTitle,
          ...(listing.listingUrl ? { listingUrl: listing.listingUrl } : {}),
          currencyCode: this.normalizeCurrencyCode(listing.currency),
          priceGross: this.minorToRequiredDecimal(listing.priceMinor),
          priceNet: this.optionalMinorToDecimal(listing.netPriceMinor),
          quantityAvailable: Math.max(0, listing.quantityAvailable),
          listingStatus: ListingStatus.ACTIVE,
          lastSeenAt: listing.observedAt,
          attributes: this.buildListingAttributes(listing),
        },
        update: {
          sourceItemId: listing.sourceItemId,
          canonicalItemId: listing.canonicalItemId,
          itemVariantId: listing.itemVariantId,
          title: normalizedTitle,
          normalizedTitle,
          ...(listing.listingUrl ? { listingUrl: listing.listingUrl } : {}),
          currencyCode: this.normalizeCurrencyCode(listing.currency),
          priceGross: this.minorToRequiredDecimal(listing.priceMinor),
          priceNet: this.optionalMinorToDecimal(listing.netPriceMinor),
          quantityAvailable: Math.max(0, listing.quantityAvailable),
          listingStatus: ListingStatus.ACTIVE,
          lastSeenAt: listing.observedAt,
          attributes: this.buildListingAttributes(listing),
        },
      });

      sourceListingIds.push(storedListing.id);
      storedListings.push({
        id: storedListing.id,
        externalListingId: listing.externalListingId,
        itemVariantId: listing.itemVariantId,
        canonicalItemId: listing.canonicalItemId,
        observedAt: listing.observedAt,
      });
    }

    this.logger.log(
      `Persisted ${sourceListingIds.length} source listings for ${input.source}:${input.endpointName} (${input.rawPayloadArchiveId}); skipped ${skippedCount}.`,
      SourceListingStorageService.name,
    );

    return {
      source: input.source,
      rawPayloadArchiveId: input.rawPayloadArchiveId,
      storedCount: sourceListingIds.length,
      skippedCount,
      sourceListingIds,
      storedListings,
    };
  }

  async refreshActiveListingsHeartbeatForVariants(input: {
    readonly source: SourceAdapterKey;
    readonly itemVariantIds: readonly string[];
    readonly observedAt: Date;
  }): Promise<number> {
    const itemVariantIds = [...new Set(input.itemVariantIds)];

    if (itemVariantIds.length === 0) {
      return 0;
    }

    const source = await this.sourceRecordService.resolveByKey(input.source);
    const result = await this.prismaService.sourceListing.updateMany({
      where: {
        sourceId: source.id,
        listingStatus: ListingStatus.ACTIVE,
        itemVariantId: {
          in: itemVariantIds,
        },
      },
      data: {
        lastSeenAt: input.observedAt,
      },
    });

    return result.count;
  }

  private buildListingAttributes(
    listing: NormalizedSourcePayloadDto['listings'][number],
  ): Prisma.InputJsonValue {
    const serializedMetadata = listing.metadata
      ? (JSON.parse(JSON.stringify(listing.metadata)) as Prisma.InputJsonValue)
      : null;

    const attributes = {
      condition: listing.condition ?? null,
      phase: listing.phase ?? null,
      paintSeed: listing.paintSeed ?? null,
      wearFloat: listing.wearFloat ?? null,
      isStatTrak: listing.isStatTrak,
      isSouvenir: listing.isSouvenir,
      ...(serializedMetadata !== null ? { metadata: serializedMetadata } : {}),
    } satisfies Prisma.InputJsonObject;

    return attributes;
  }

  private normalizeCurrencyCode(currency: string): string {
    return currency.trim().toUpperCase().slice(0, 3) || 'USD';
  }

  private normalizeTitle(title: string): string {
    return this.aliasNormalizationService.normalizeMarketHashName(title);
  }

  private minorToRequiredDecimal(value: number): Prisma.Decimal {
    const absoluteMinor = Math.abs(value);
    const units = Math.trunc(absoluteMinor / 100);
    const cents = absoluteMinor % 100;
    const prefix = value < 0 ? '-' : '';

    return new Prisma.Decimal(
      `${prefix}${units}.${cents.toString().padStart(2, '0')}`,
    );
  }

  private optionalMinorToDecimal(
    value: number | undefined,
  ): Prisma.Decimal | null {
    if (value === undefined) {
      return null;
    }

    return this.minorToRequiredDecimal(value);
  }
}
