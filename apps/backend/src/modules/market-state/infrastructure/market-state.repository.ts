import { ListingStatus, Prisma, SourceKind } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';
import {
  chunkArray,
  mapWithConcurrencyLimit,
} from '../../shared/utils/async.util';
import type {
  MarketReadRepository,
  MarketSnapshotRecord,
} from '../domain/market-read.repository';

type ItemVariantBaseRecord = Prisma.ItemVariantGetPayload<{
  include: {
    canonicalItem: {
      select: {
        id: true;
        displayName: true;
        category: true;
      };
    };
  };
}>;
type MarketStateRecord = Prisma.MarketStateGetPayload<{
  include: {
    source: true;
    latestSnapshot: true;
  };
}>;

interface SnapshotHistoryRow {
  readonly itemVariantId: string;
  readonly snapshotId: string;
  readonly sourceId: string;
  readonly sourceCode: string;
  readonly sourceName: string;
  readonly sourceKind: string;
  readonly sourceMetadata: Prisma.JsonValue | null;
  readonly currencyCode: string;
  readonly lowestAskGross: Prisma.Decimal | null;
  readonly highestBidGross: Prisma.Decimal | null;
  readonly listingCount: number | null;
  readonly observedAt: Date;
  readonly confidence: Prisma.Decimal | null;
  readonly rawPayloadArchiveId: string | null;
}

const MARKET_STATE_READ_CHUNK_SIZE = 5_000;
const MARKET_STATE_READ_CONCURRENCY_LIMIT = 2;

@Injectable()
export class MarketStateRepositoryAdapter implements MarketReadRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
  ) {}

  async findVariantRecord(itemVariantId: string) {
    const [variantRecord] = await this.findVariantRecords([itemVariantId]);

    return variantRecord ?? null;
  }

  async findVariantRecords(itemVariantIds: readonly string[]) {
    const uniqueItemVariantIds = [...new Set(itemVariantIds)];

    if (uniqueItemVariantIds.length === 0) {
      return [];
    }

    const itemVariants = (
      await mapWithConcurrencyLimit(
        chunkArray(uniqueItemVariantIds, MARKET_STATE_READ_CHUNK_SIZE),
        MARKET_STATE_READ_CONCURRENCY_LIMIT,
        async (itemVariantIdChunk) =>
          this.prismaService.itemVariant.findMany({
            where: {
              id: {
                in: itemVariantIdChunk,
              },
            },
            include: {
              canonicalItem: {
                select: {
                  id: true,
                  displayName: true,
                  category: true,
                },
              },
            },
          }),
      )
    ).flat();
    const marketStatesByVariant =
      await this.findMarketStatesByVariantIds(
        itemVariants.map((itemVariant) => itemVariant.id),
      );
    const representativeListingsByVariant =
      await this.findRepresentativeListings(
        itemVariants.map((itemVariant) => itemVariant.id),
      );
    const recordsById = new Map(
      itemVariants.map((itemVariant) => [
        itemVariant.id,
        this.toVariantRecord(
          itemVariant,
          marketStatesByVariant.get(itemVariant.id) ?? [],
          representativeListingsByVariant.get(itemVariant.id),
        ),
      ]),
    );

    return uniqueItemVariantIds.flatMap((itemVariantId) => {
      const variantRecord = recordsById.get(itemVariantId);

      return variantRecord ? [variantRecord] : [];
    });
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
    const marketStatesByVariant =
      await this.findMarketStatesByVariantIds(
        itemVariants.map((itemVariant) => itemVariant.id),
      );

    const representativeListingsByVariant =
      await this.findRepresentativeListings(
        itemVariants.map((itemVariant) => itemVariant.id),
      );

    return itemVariants.map((itemVariant) =>
      this.toVariantRecord(
        itemVariant,
        marketStatesByVariant.get(itemVariant.id) ?? [],
        representativeListingsByVariant.get(itemVariant.id),
      ),
    );
  }

  async findVariantSnapshotHistory(itemVariantId: string, limit: number) {
    const snapshotHistories = await this.findVariantSnapshotHistories(
      [itemVariantId],
      limit,
    );

    return snapshotHistories.get(itemVariantId) ?? [];
  }

  async findVariantSnapshotHistories(
    itemVariantIds: readonly string[],
    limit: number,
  ) {
    const uniqueItemVariantIds = [...new Set(itemVariantIds)];

    if (uniqueItemVariantIds.length === 0) {
      return new Map<string, readonly MarketSnapshotRecord[]>();
    }

    const rows = (
      await mapWithConcurrencyLimit(
        chunkArray(uniqueItemVariantIds, MARKET_STATE_READ_CHUNK_SIZE),
        MARKET_STATE_READ_CONCURRENCY_LIMIT,
        async (itemVariantIdChunk) =>
          this.prismaService.$queryRaw<SnapshotHistoryRow[]>(
            Prisma.sql`
              SELECT ranked."itemVariantId",
                     ranked."snapshotId",
                     ranked."sourceId",
                     ranked."sourceCode",
                     ranked."sourceName",
                     ranked."sourceKind",
                     ranked."sourceMetadata",
                     ranked."currencyCode",
                     ranked."lowestAskGross",
                     ranked."highestBidGross",
                     ranked."listingCount",
                     ranked."observedAt",
                     ranked."confidence",
                     ranked."rawPayloadArchiveId"
              FROM (
                SELECT
                  snapshot."itemVariantId" AS "itemVariantId",
                  snapshot.id AS "snapshotId",
                  snapshot."sourceId" AS "sourceId",
                  source.code AS "sourceCode",
                  source.name AS "sourceName",
                  source.kind AS "sourceKind",
                  source.metadata AS "sourceMetadata",
                  snapshot."currencyCode" AS "currencyCode",
                  snapshot."lowestAskGross" AS "lowestAskGross",
                  snapshot."highestBidGross" AS "highestBidGross",
                  snapshot."listingCount" AS "listingCount",
                  snapshot."observedAt" AS "observedAt",
                  snapshot.confidence AS "confidence",
                  snapshot."rawPayloadArchiveId" AS "rawPayloadArchiveId",
                  ROW_NUMBER() OVER (
                    PARTITION BY snapshot."itemVariantId"
                    ORDER BY snapshot."observedAt" DESC, snapshot."createdAt" DESC
                  ) AS "rowNumber"
                FROM "MarketSnapshot" AS snapshot
                INNER JOIN "Source" AS source
                  ON source.id = snapshot."sourceId"
                WHERE snapshot."itemVariantId" IN (${Prisma.join(
                  itemVariantIdChunk.map(
                    (itemVariantId) => Prisma.sql`${itemVariantId}::uuid`,
                  ),
                )})
              ) AS ranked
              WHERE ranked."rowNumber" <= ${limit}
              ORDER BY ranked."itemVariantId" ASC, ranked."observedAt" DESC
            `,
          ),
      )
    ).flat();
    const snapshotHistories = new Map<string, MarketSnapshotRecord[]>();

    for (const itemVariantId of uniqueItemVariantIds) {
      snapshotHistories.set(itemVariantId, []);
    }

    for (const row of rows) {
      const snapshotHistory = snapshotHistories.get(row.itemVariantId);

      if (!snapshotHistory) {
        continue;
      }

      snapshotHistory.push({
        snapshotId: row.snapshotId,
        sourceId: row.sourceId,
        sourceCode: row.sourceCode as SourceAdapterKey,
        sourceName: row.sourceName,
        sourceKind: row.sourceKind as SourceKind,
        sourceMetadata: row.sourceMetadata,
        currencyCode: row.currencyCode,
        lowestAskGross: row.lowestAskGross,
        highestBidGross: row.highestBidGross,
        listingCount: row.listingCount,
        observedAt: row.observedAt,
        confidence: row.confidence,
        rawPayloadArchiveId: row.rawPayloadArchiveId,
      });
    }

    return snapshotHistories;
  }

  private async findMarketStatesByVariantIds(
    itemVariantIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly MarketStateRecord[]>> {
    const uniqueItemVariantIds = [...new Set(itemVariantIds)];

    if (uniqueItemVariantIds.length === 0) {
      return new Map();
    }

    const marketStates = (
      await mapWithConcurrencyLimit(
        chunkArray(uniqueItemVariantIds, MARKET_STATE_READ_CHUNK_SIZE),
        MARKET_STATE_READ_CONCURRENCY_LIMIT,
        async (itemVariantIdChunk) =>
          this.prismaService.marketState.findMany({
            where: {
              itemVariantId: {
                in: itemVariantIdChunk,
              },
            },
            include: {
              source: true,
              latestSnapshot: true,
            },
            orderBy: [
              {
                itemVariantId: 'asc',
              },
              {
                observedAt: 'desc',
              },
            ],
          }),
      )
    ).flat();
    const marketStatesByVariant = new Map<string, MarketStateRecord[]>();

    for (const itemVariantId of uniqueItemVariantIds) {
      marketStatesByVariant.set(itemVariantId, []);
    }

    for (const marketState of marketStates) {
      const records = marketStatesByVariant.get(marketState.itemVariantId);

      if (!records) {
        continue;
      }

      records.push(marketState);
    }

    for (const records of marketStatesByVariant.values()) {
      records.sort((left, right) => this.compareMarketStates(left, right));
    }

    return marketStatesByVariant;
  }

  private toVariantRecord(
    itemVariant: ItemVariantBaseRecord,
    marketStates: readonly MarketStateRecord[],
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
      marketStates: marketStates.map((marketState) => ({
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

  private compareMarketStates(
    left: MarketStateRecord,
    right: MarketStateRecord,
  ): number {
    const sourceKindDifference = left.source.kind.localeCompare(right.source.kind);

    if (sourceKindDifference !== 0) {
      return sourceKindDifference;
    }

    return left.source.name.localeCompare(right.source.name);
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

    const listings = (
      await mapWithConcurrencyLimit(
        chunkArray([...new Set(itemVariantIds)], MARKET_STATE_READ_CHUNK_SIZE),
        MARKET_STATE_READ_CONCURRENCY_LIMIT,
        async (itemVariantIdChunk) =>
          this.prismaService.sourceListing.findMany({
            where: {
              itemVariantId: {
                in: itemVariantIdChunk,
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
          }),
      )
    ).flat();
    const representativeListingsByVariant = new Map<
      string,
      Map<
        string,
        {
          readonly id: string;
          readonly externalListingId: string;
          readonly title: string;
          readonly listingUrl: string | null;
          readonly attributes: Prisma.JsonValue | null;
          readonly priceGross: Prisma.Decimal;
          readonly lastSeenAt: Date;
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
            readonly listingUrl: string | null;
            readonly attributes: Prisma.JsonValue | null;
            readonly priceGross: Prisma.Decimal;
            readonly lastSeenAt: Date;
          }
        >();

      if (!representativeListingsByVariant.has(listing.itemVariantId)) {
        representativeListingsByVariant.set(
          listing.itemVariantId,
          listingsBySource,
        );
      }

      const currentRepresentative = listingsBySource.get(listing.sourceId);
      const candidateRepresentative = {
        id: listing.id,
        externalListingId: listing.externalListingId,
        title: listing.title,
        listingUrl: listing.listingUrl ?? null,
        attributes: listing.attributes ?? null,
        priceGross: listing.priceGross,
        lastSeenAt: listing.lastSeenAt,
      };

      if (
        !currentRepresentative ||
        this.isBetterRepresentativeListing(
          candidateRepresentative,
          currentRepresentative,
        )
      ) {
        listingsBySource.set(listing.sourceId, candidateRepresentative);
      }
    }

    return new Map(
      [...representativeListingsByVariant.entries()].map(
        ([itemVariantId, listingsBySource]) => [
          itemVariantId,
          new Map(
            [...listingsBySource.entries()].map(([sourceId, listing]) => [
              sourceId,
              {
                id: listing.id,
                externalListingId: listing.externalListingId,
                title: listing.title,
                listingUrl: listing.listingUrl,
                attributes: listing.attributes,
              },
            ]),
          ),
        ],
      ),
    );
  }

  private isBetterRepresentativeListing(
    candidate: {
      readonly priceGross: Prisma.Decimal;
      readonly lastSeenAt: Date;
      readonly attributes?: Prisma.JsonValue | null;
    },
    current: {
      readonly priceGross: Prisma.Decimal;
      readonly lastSeenAt: Date;
      readonly attributes?: Prisma.JsonValue | null;
    },
  ): boolean {
    const candidateIdentityScore = this.scoreRepresentativeListing(candidate.attributes);
    const currentIdentityScore = this.scoreRepresentativeListing(current.attributes);

    if (candidateIdentityScore !== currentIdentityScore) {
      return candidateIdentityScore > currentIdentityScore;
    }

    const priceDifference =
      Number(candidate.priceGross.toString()) - Number(current.priceGross.toString());

    if (priceDifference !== 0) {
      return priceDifference < 0;
    }

    return candidate.lastSeenAt.getTime() > current.lastSeenAt.getTime();
  }

  private scoreRepresentativeListing(
    attributes: Prisma.JsonValue | null | undefined,
  ): number {
    if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) {
      return 0;
    }

    const record = attributes as Prisma.JsonObject;
    let score = 0;

    if (typeof record.wearFloat === 'number') {
      score += 4;
    }

    if (typeof record.paintSeed === 'number') {
      score += 4;
    }

    if (typeof record.phase === 'string' && record.phase.trim().length > 0) {
      score += 3;
    }

    if (typeof record.condition === 'string' && record.condition.trim().length > 0) {
      score += 2;
    }

    const metadata =
      record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
        ? (record.metadata as Prisma.JsonObject)
        : undefined;

    if (metadata) {
      const seller =
        metadata.seller &&
        typeof metadata.seller === 'object' &&
        !Array.isArray(metadata.seller)
          ? (metadata.seller as Prisma.JsonObject)
          : undefined;
      const scm =
        metadata.scm &&
        typeof metadata.scm === 'object' &&
        !Array.isArray(metadata.scm)
          ? (metadata.scm as Prisma.JsonObject)
          : undefined;

      if (seller && Object.keys(seller).length > 0) {
        score += 2;
      }

      if (scm && Object.keys(scm).length > 0) {
        score += 1;
      }
    }

    return score;
  }
}
