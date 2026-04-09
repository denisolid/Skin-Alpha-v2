import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';
import type {
  AppendSnapshotAndProjectLatestStateInput,
  LatestMarketSnapshotProjectionRecord,
  MarketStateProjectionRecord,
  MarketStateWriteRepository,
  MarketStateWriteSourceRecord,
} from '../domain/market-state-write.repository';

@Injectable()
export class MarketStateWriteRepositoryAdapter
  implements MarketStateWriteRepository
{
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
  ) {}

  async findSourceByCode(
    sourceCode: SourceAdapterKey,
  ): Promise<MarketStateWriteSourceRecord | null> {
    const source = await this.prismaService.source.findUnique({
      where: {
        code: sourceCode,
      },
      select: {
        id: true,
        code: true,
      },
    });

    return source
      ? {
          id: source.id,
          code: source.code as SourceAdapterKey,
        }
      : null;
  }

  async appendSnapshotAndProjectLatestState(
    input: AppendSnapshotAndProjectLatestStateInput,
  ): Promise<MarketStateProjectionRecord> {
    return this.prismaService.$transaction(async (transaction) => {
      const snapshot = await transaction.marketSnapshot.create({
        data: {
          sourceId: input.sourceId,
          canonicalItemId: input.canonicalItemId,
          itemVariantId: input.itemVariantId,
          ...(input.rawPayloadArchiveId
            ? { rawPayloadArchiveId: input.rawPayloadArchiveId }
            : {}),
          currencyCode: input.currencyCode,
          ...(input.lowestAskGross !== undefined
            ? { lowestAskGross: input.lowestAskGross }
            : {}),
          ...(input.highestBidGross !== undefined
            ? { highestBidGross: input.highestBidGross }
            : {}),
          ...(input.lastTradeGross !== undefined
            ? { lastTradeGross: input.lastTradeGross }
            : {}),
          ...(input.average24hGross !== undefined
            ? { average24hGross: input.average24hGross }
            : {}),
          ...(input.listingCount !== undefined
            ? { listingCount: input.listingCount }
            : {}),
          ...(input.saleCount24h !== undefined
            ? { saleCount24h: input.saleCount24h }
            : {}),
          ...(input.sampleSize !== undefined
            ? { sampleSize: input.sampleSize }
            : {}),
          ...(input.confidence !== undefined
            ? { confidence: input.confidence }
            : {}),
          observedAt: input.observedAt,
        },
        select: {
          id: true,
        },
      });
      const marketState = await transaction.marketState.upsert({
        where: {
          sourceId_itemVariantId: {
            sourceId: input.sourceId,
            itemVariantId: input.itemVariantId,
          },
        },
        create: {
          sourceId: input.sourceId,
          canonicalItemId: input.canonicalItemId,
          itemVariantId: input.itemVariantId,
          latestSnapshotId: snapshot.id,
          currencyCode: input.currencyCode,
          observedAt: input.observedAt,
          lastSyncedAt: new Date(),
          ...(input.lowestAskGross !== undefined
            ? { lowestAskGross: input.lowestAskGross }
            : {}),
          ...(input.highestBidGross !== undefined
            ? { highestBidGross: input.highestBidGross }
            : {}),
          ...(input.lastTradeGross !== undefined
            ? { lastTradeGross: input.lastTradeGross }
            : {}),
          ...(input.average24hGross !== undefined
            ? { average24hGross: input.average24hGross }
            : {}),
          ...(input.listingCount !== undefined
            ? { listingCount: input.listingCount }
            : {}),
          ...(input.saleCount24h !== undefined
            ? { saleCount24h: input.saleCount24h }
            : {}),
          ...(input.confidence !== undefined
            ? { confidence: input.confidence }
            : {}),
          ...(input.liquidityScore !== undefined
            ? { liquidityScore: input.liquidityScore }
            : {}),
        },
        update: {
          canonicalItemId: input.canonicalItemId,
          latestSnapshotId: snapshot.id,
          currencyCode: input.currencyCode,
          observedAt: input.observedAt,
          lastSyncedAt: new Date(),
          ...(input.lowestAskGross !== undefined
            ? { lowestAskGross: input.lowestAskGross }
            : {}),
          ...(input.highestBidGross !== undefined
            ? { highestBidGross: input.highestBidGross }
            : {}),
          ...(input.lastTradeGross !== undefined
            ? { lastTradeGross: input.lastTradeGross }
            : {}),
          ...(input.average24hGross !== undefined
            ? { average24hGross: input.average24hGross }
            : {}),
          ...(input.listingCount !== undefined
            ? { listingCount: input.listingCount }
            : {}),
          ...(input.saleCount24h !== undefined
            ? { saleCount24h: input.saleCount24h }
            : {}),
          ...(input.confidence !== undefined
            ? { confidence: input.confidence }
            : {}),
          ...(input.liquidityScore !== undefined
            ? { liquidityScore: input.liquidityScore }
            : {}),
        },
        select: {
          id: true,
        },
      });

      return {
        sourceId: input.sourceId,
        sourceCode: input.sourceCode,
        canonicalItemId: input.canonicalItemId,
        itemVariantId: input.itemVariantId,
        marketStateId: marketState.id,
        latestSnapshotId: snapshot.id,
        observedAt: input.observedAt,
        rawPayloadArchiveId: input.rawPayloadArchiveId ?? null,
      };
    });
  }

  async findLatestSnapshotsForProjection(): Promise<
    readonly LatestMarketSnapshotProjectionRecord[]
  > {
    const latestSnapshots = await this.prismaService.marketSnapshot.findMany({
      distinct: ['sourceId', 'itemVariantId'],
      orderBy: [
        {
          sourceId: 'asc',
        },
        {
          itemVariantId: 'asc',
        },
        {
          observedAt: 'desc',
        },
        {
          createdAt: 'desc',
        },
      ],
      include: {
        source: {
          select: {
            code: true,
          },
        },
      },
    });

    return latestSnapshots.map((snapshot) => ({
      sourceId: snapshot.sourceId,
      sourceCode: snapshot.source.code as SourceAdapterKey,
      canonicalItemId: snapshot.canonicalItemId,
      itemVariantId: snapshot.itemVariantId,
      snapshotId: snapshot.id,
      rawPayloadArchiveId: snapshot.rawPayloadArchiveId,
      currencyCode: snapshot.currencyCode,
      lowestAskGross: snapshot.lowestAskGross,
      highestBidGross: snapshot.highestBidGross,
      lastTradeGross: snapshot.lastTradeGross,
      average24hGross: snapshot.average24hGross,
      listingCount: snapshot.listingCount,
      saleCount24h: snapshot.saleCount24h,
      confidence: snapshot.confidence,
      observedAt: snapshot.observedAt,
    }));
  }

  async projectLatestStateFromSnapshot(
    snapshot: LatestMarketSnapshotProjectionRecord,
  ): Promise<MarketStateProjectionRecord> {
    const marketState = await this.prismaService.marketState.upsert({
      where: {
        sourceId_itemVariantId: {
          sourceId: snapshot.sourceId,
          itemVariantId: snapshot.itemVariantId,
        },
      },
      create: {
        sourceId: snapshot.sourceId,
        canonicalItemId: snapshot.canonicalItemId,
        itemVariantId: snapshot.itemVariantId,
        latestSnapshotId: snapshot.snapshotId,
        currencyCode: snapshot.currencyCode,
        observedAt: snapshot.observedAt,
        lastSyncedAt: new Date(),
        ...(snapshot.lowestAskGross !== undefined
          ? { lowestAskGross: snapshot.lowestAskGross }
          : {}),
        ...(snapshot.highestBidGross !== undefined
          ? { highestBidGross: snapshot.highestBidGross }
          : {}),
        ...(snapshot.lastTradeGross !== undefined
          ? { lastTradeGross: snapshot.lastTradeGross }
          : {}),
        ...(snapshot.average24hGross !== undefined
          ? { average24hGross: snapshot.average24hGross }
          : {}),
        ...(snapshot.listingCount !== undefined
          ? { listingCount: snapshot.listingCount }
          : {}),
        ...(snapshot.saleCount24h !== undefined
          ? { saleCount24h: snapshot.saleCount24h }
          : {}),
        ...(snapshot.confidence !== undefined
          ? { confidence: snapshot.confidence }
          : {}),
      },
      update: {
        canonicalItemId: snapshot.canonicalItemId,
        latestSnapshotId: snapshot.snapshotId,
        currencyCode: snapshot.currencyCode,
        observedAt: snapshot.observedAt,
        lastSyncedAt: new Date(),
        ...(snapshot.lowestAskGross !== undefined
          ? { lowestAskGross: snapshot.lowestAskGross }
          : {}),
        ...(snapshot.highestBidGross !== undefined
          ? { highestBidGross: snapshot.highestBidGross }
          : {}),
        ...(snapshot.lastTradeGross !== undefined
          ? { lastTradeGross: snapshot.lastTradeGross }
          : {}),
        ...(snapshot.average24hGross !== undefined
          ? { average24hGross: snapshot.average24hGross }
          : {}),
        ...(snapshot.listingCount !== undefined
          ? { listingCount: snapshot.listingCount }
          : {}),
        ...(snapshot.saleCount24h !== undefined
          ? { saleCount24h: snapshot.saleCount24h }
          : {}),
        ...(snapshot.confidence !== undefined
          ? { confidence: snapshot.confidence }
          : {}),
      },
      select: {
        id: true,
      },
    });

    return {
      sourceId: snapshot.sourceId,
      sourceCode: snapshot.sourceCode,
      canonicalItemId: snapshot.canonicalItemId,
      itemVariantId: snapshot.itemVariantId,
      marketStateId: marketState.id,
      latestSnapshotId: snapshot.snapshotId,
      observedAt: snapshot.observedAt,
      rawPayloadArchiveId: snapshot.rawPayloadArchiveId ?? null,
    };
  }
}
