import { ListingStatus, Prisma } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';
import type { MarketReadRepository } from '../domain/market-read.repository';

type ItemVariantRecord = Prisma.ItemVariantGetPayload<{
  include: {
    canonicalItem: {
      select: {
        id: true;
        displayName: true;
        category: true;
      };
    };
    marketStates: {
      include: {
        source: true;
        latestSnapshot: true;
      };
    };
  };
}>;

@Injectable()
export class MarketStateRepositoryAdapter implements MarketReadRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
  ) {}

  async findVariantRecord(itemVariantId: string) {
    const itemVariant = await this.prismaService.itemVariant.findUnique({
      where: {
        id: itemVariantId,
      },
      include: {
        canonicalItem: {
          select: {
            id: true,
            displayName: true,
            category: true,
          },
        },
        marketStates: {
          include: {
            source: true,
            latestSnapshot: true,
          },
          orderBy: [
            {
              source: {
                kind: 'asc',
              },
            },
            {
              source: {
                name: 'asc',
              },
            },
          ],
        },
      },
    });

    if (!itemVariant) {
      return null;
    }

    const representativeListingsByVariant =
      await this.findRepresentativeListings([itemVariant.id]);

    return this.toVariantRecord(
      itemVariant,
      representativeListingsByVariant.get(itemVariant.id),
    );
  }

  async findVariantRecordsByCanonicalItem(canonicalItemId: string) {
    const itemVariants = await this.prismaService.itemVariant.findMany({
      where: {
        canonicalItemId,
      },
      include: {
        canonicalItem: {
          select: {
            id: true,
            displayName: true,
            category: true,
          },
        },
        marketStates: {
          include: {
            source: true,
            latestSnapshot: true,
          },
          orderBy: [
            {
              source: {
                kind: 'asc',
              },
            },
            {
              source: {
                name: 'asc',
              },
            },
          ],
        },
      },
      orderBy: [
        {
          sortOrder: 'asc',
        },
        {
          displayName: 'asc',
        },
      ],
    });

    const representativeListingsByVariant =
      await this.findRepresentativeListings(
        itemVariants.map((itemVariant) => itemVariant.id),
      );

    return itemVariants.map((itemVariant) =>
      this.toVariantRecord(
        itemVariant,
        representativeListingsByVariant.get(itemVariant.id),
      ),
    );
  }

  async findVariantSnapshotHistory(itemVariantId: string, limit: number) {
    const snapshots = await this.prismaService.marketSnapshot.findMany({
      where: {
        itemVariantId,
      },
      include: {
        source: true,
      },
      orderBy: [
        {
          observedAt: 'desc',
        },
        {
          createdAt: 'desc',
        },
      ],
      take: limit,
    });

    return snapshots.map((snapshot) => ({
      snapshotId: snapshot.id,
      sourceId: snapshot.sourceId,
      sourceCode: snapshot.source.code as SourceAdapterKey,
      sourceName: snapshot.source.name,
      sourceKind: snapshot.source.kind,
      sourceMetadata: snapshot.source.metadata,
      currencyCode: snapshot.currencyCode,
      lowestAskGross: snapshot.lowestAskGross,
      highestBidGross: snapshot.highestBidGross,
      listingCount: snapshot.listingCount,
      observedAt: snapshot.observedAt,
      confidence: snapshot.confidence,
      rawPayloadArchiveId: snapshot.rawPayloadArchiveId,
    }));
  }

  private toVariantRecord(
    itemVariant: ItemVariantRecord,
    representativeListingsBySource:
      | ReadonlyMap<
          string,
          {
            readonly id: string;
            readonly externalListingId: string;
            readonly title: string;
            readonly listingUrl?: string | null;
            readonly attributes?: Prisma.JsonValue | null;
          }
        >
      | undefined,
  ) {
    return {
      canonicalItemId: itemVariant.canonicalItem.id,
      canonicalDisplayName: itemVariant.canonicalItem.displayName,
      category: itemVariant.canonicalItem.category,
      itemVariantId: itemVariant.id,
      variantKey: itemVariant.variantKey,
      variantDisplayName: itemVariant.displayName,
      variantMetadata: itemVariant.metadata,
      marketStates: itemVariant.marketStates.map((marketState) => ({
        sourceId: marketState.sourceId,
        sourceCode: marketState.source.code as SourceAdapterKey,
        sourceName: marketState.source.name,
        sourceKind: marketState.source.kind,
        sourceMetadata: marketState.source.metadata,
        representativeListing:
          representativeListingsBySource?.get(marketState.sourceId) ?? null,
        latestSnapshotId: marketState.latestSnapshotId,
        currencyCode: marketState.currencyCode,
        lowestAskGross: marketState.lowestAskGross,
        highestBidGross: marketState.highestBidGross,
        listingCount: marketState.listingCount,
        observedAt: marketState.observedAt,
        lastSyncedAt: marketState.lastSyncedAt,
        confidence: marketState.confidence,
        ...(marketState.latestSnapshot
          ? {
              latestSnapshot: {
                id: marketState.latestSnapshot.id,
                currencyCode: marketState.latestSnapshot.currencyCode,
                lowestAskGross: marketState.latestSnapshot.lowestAskGross,
                highestBidGross: marketState.latestSnapshot.highestBidGross,
                listingCount: marketState.latestSnapshot.listingCount,
                observedAt: marketState.latestSnapshot.observedAt,
                confidence: marketState.latestSnapshot.confidence,
                rawPayloadArchiveId:
                  marketState.latestSnapshot.rawPayloadArchiveId,
              },
            }
          : {}),
      })),
    };
  }

  private async findRepresentativeListings(itemVariantIds: readonly string[]) {
    if (itemVariantIds.length === 0) {
      return new Map<
        string,
        Map<
          string,
          {
            readonly id: string;
            readonly externalListingId: string;
            readonly title: string;
            readonly listingUrl?: string | null;
            readonly attributes?: Prisma.JsonValue | null;
          }
        >
      >();
    }

    const listings = await this.prismaService.sourceListing.findMany({
      where: {
        itemVariantId: {
          in: [...new Set(itemVariantIds)],
        },
        listingStatus: ListingStatus.ACTIVE,
      },
      select: {
        id: true,
        itemVariantId: true,
        sourceId: true,
        externalListingId: true,
        title: true,
        listingUrl: true,
        attributes: true,
        priceGross: true,
        lastSeenAt: true,
      },
      orderBy: [
        {
          itemVariantId: 'asc',
        },
        {
          sourceId: 'asc',
        },
        {
          priceGross: 'asc',
        },
        {
          lastSeenAt: 'desc',
        },
      ],
    });
    const representativeListingsByVariant = new Map<
      string,
      Map<
        string,
        {
          readonly id: string;
          readonly externalListingId: string;
          readonly title: string;
          readonly listingUrl?: string | null;
          readonly attributes?: Prisma.JsonValue | null;
        }
      >
    >();

    for (const listing of listings) {
      const listingsBySource =
        representativeListingsByVariant.get(listing.itemVariantId) ??
        new Map<
          string,
          {
            readonly id: string;
            readonly externalListingId: string;
            readonly title: string;
            readonly listingUrl?: string | null;
            readonly attributes?: Prisma.JsonValue | null;
          }
        >();

      if (!representativeListingsByVariant.has(listing.itemVariantId)) {
        representativeListingsByVariant.set(
          listing.itemVariantId,
          listingsBySource,
        );
      }

      if (!listingsBySource.has(listing.sourceId)) {
        listingsBySource.set(listing.sourceId, {
          id: listing.id,
          externalListingId: listing.externalListingId,
          title: listing.title,
          listingUrl: listing.listingUrl,
          attributes: listing.attributes,
        });
      }
    }

    return representativeListingsByVariant;
  }
}
