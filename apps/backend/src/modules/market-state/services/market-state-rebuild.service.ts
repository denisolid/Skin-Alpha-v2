import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { MarketStateRebuildResultDto } from '../dto/market-state-rebuild-result.dto';

@Injectable()
export class MarketStateRebuildService {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
  ) {}

  async rebuildLatestStateProjection(): Promise<MarketStateRebuildResultDto> {
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
    });
    let rebuiltStateCount = 0;

    for (const snapshot of latestSnapshots) {
      await this.prismaService.marketState.upsert({
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
          latestSnapshotId: snapshot.id,
          currencyCode: snapshot.currencyCode,
          lowestAskGross: snapshot.lowestAskGross,
          highestBidGross: snapshot.highestBidGross,
          lastTradeGross: snapshot.lastTradeGross,
          average24hGross: snapshot.average24hGross,
          listingCount: snapshot.listingCount,
          saleCount24h: snapshot.saleCount24h,
          confidence: snapshot.confidence,
          observedAt: snapshot.observedAt,
          lastSyncedAt: new Date(),
        },
        update: {
          canonicalItemId: snapshot.canonicalItemId,
          latestSnapshotId: snapshot.id,
          currencyCode: snapshot.currencyCode,
          lowestAskGross: snapshot.lowestAskGross,
          highestBidGross: snapshot.highestBidGross,
          lastTradeGross: snapshot.lastTradeGross,
          average24hGross: snapshot.average24hGross,
          listingCount: snapshot.listingCount,
          saleCount24h: snapshot.saleCount24h,
          confidence: snapshot.confidence,
          observedAt: snapshot.observedAt,
          lastSyncedAt: new Date(),
        },
      });
      rebuiltStateCount += 1;
    }

    return {
      processedSnapshotCount: latestSnapshots.length,
      rebuiltStateCount,
    };
  }
}
