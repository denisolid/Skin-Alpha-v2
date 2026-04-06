import { ListingStatus, Prisma } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { AppLoggerService } from '../../../infrastructure/logging/app-logger.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
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
    @Inject(SourceRecordService)
    private readonly sourceRecordService: SourceRecordService,
  ) {}

  async storeNormalizedListings(
    input: NormalizedSourcePayloadDto,
  ): Promise<NormalizedListingStorageResultDto> {
    const source = await this.sourceRecordService.resolveByKey(input.source);
    const sourceListingIds: string[] = [];
    let skippedCount = 0;

    for (const listing of input.listings) {
      if (!listing.canonicalItemId || !listing.itemVariantId) {
        skippedCount += 1;
        continue;
      }

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
          title: listing.title,
          normalizedTitle: this.normalizeTitle(listing.title),
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
          title: listing.title,
          normalizedTitle: this.normalizeTitle(listing.title),
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
    };
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
    return title.trim().replace(/\s+/g, ' ');
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
