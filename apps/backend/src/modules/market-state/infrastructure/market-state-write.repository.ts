import { Prisma } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';
import type {
  AppendSnapshotAndProjectLatestStateInput,
  LatestMarketSnapshotProjectionRecord,
  MarketStateProjectionRecord,
  RefreshedMarketStateHeartbeatRecord,
  RefreshLatestMarketStateHeartbeatInput,
  RefreshLatestMarketStateHeartbeatForVariantsInput,
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
      const now = new Date();
      const currentState = await transaction.marketState.findUnique({
        where: {
          sourceId_itemVariantId: {
            sourceId: input.sourceId,
            itemVariantId: input.itemVariantId,
          },
        },
        select: {
          id: true,
          latestSnapshotId: true,
          currencyCode: true,
          lowestAskGross: true,
          highestBidGross: true,
          lastTradeGross: true,
          average24hGross: true,
          listingCount: true,
          saleCount24h: true,
          confidence: true,
          latestSnapshot: {
            select: {
              rawPayloadArchiveId: true,
            },
          },
        },
      });
      const stateData = this.buildMarketStateData(input, now);
      const snapshotFieldsChanged =
        !currentState?.latestSnapshotId ||
        this.hasSnapshotFieldChange(currentState, input);

      if (!snapshotFieldsChanged && currentState?.latestSnapshotId) {
        const marketState = await transaction.marketState.update({
          where: {
            id: currentState.id,
          },
          data: stateData,
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
          latestSnapshotId: currentState.latestSnapshotId,
          observedAt: input.observedAt,
          snapshotCreated: false,
          unchangedProjectionSkipped: true,
          rawPayloadArchiveId:
            input.rawPayloadArchiveId ??
            currentState.latestSnapshot?.rawPayloadArchiveId ??
            null,
        };
      }

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
          ...stateData,
          sourceId: input.sourceId,
          itemVariantId: input.itemVariantId,
          latestSnapshotId: snapshot.id,
        },
        update: {
          ...stateData,
          latestSnapshotId: snapshot.id,
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
        snapshotCreated: true,
        unchangedProjectionSkipped: false,
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
    const currentState = await this.prismaService.marketState.findUnique({
      where: {
        sourceId_itemVariantId: {
          sourceId: snapshot.sourceId,
          itemVariantId: snapshot.itemVariantId,
        },
      },
      select: {
        id: true,
        canonicalItemId: true,
        latestSnapshotId: true,
        currencyCode: true,
        observedAt: true,
        lowestAskGross: true,
        highestBidGross: true,
        lastTradeGross: true,
        average24hGross: true,
        listingCount: true,
        saleCount24h: true,
        confidence: true,
      },
    });

    if (
      currentState?.latestSnapshotId === snapshot.snapshotId &&
      currentState.canonicalItemId === snapshot.canonicalItemId &&
      currentState.observedAt.getTime() === snapshot.observedAt.getTime() &&
      !this.hasSnapshotFieldChange(currentState, snapshot)
    ) {
      return {
        sourceId: snapshot.sourceId,
        sourceCode: snapshot.sourceCode,
        canonicalItemId: snapshot.canonicalItemId,
        itemVariantId: snapshot.itemVariantId,
        marketStateId: currentState.id,
        latestSnapshotId: snapshot.snapshotId,
        observedAt: snapshot.observedAt,
        snapshotCreated: false,
        unchangedProjectionSkipped: true,
        rawPayloadArchiveId: snapshot.rawPayloadArchiveId ?? null,
      };
    }

    const now = new Date();
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
        lastSyncedAt: now,
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
        lastSyncedAt: now,
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
      snapshotCreated: false,
      unchangedProjectionSkipped: false,
      rawPayloadArchiveId: snapshot.rawPayloadArchiveId ?? null,
    };
  }

  async refreshLatestStateHeartbeat(
    input: RefreshLatestMarketStateHeartbeatInput,
  ): Promise<readonly RefreshedMarketStateHeartbeatRecord[]> {
    const refreshedAt = new Date();

    return this.prismaService.$queryRaw<RefreshedMarketStateHeartbeatRecord[]>(
      Prisma.sql`
        UPDATE "MarketState" AS ms
        SET
          "observedAt" = ${input.observedAt},
          "lastSyncedAt" = ${refreshedAt},
          "updatedAt" = ${refreshedAt}
        FROM "SourceMarketFact" AS smf
        WHERE smf."sourceId" = ${input.sourceId}::uuid
          AND smf."rawPayloadArchiveId" = ${input.equivalentRawPayloadArchiveId}::uuid
          AND ms."sourceId" = smf."sourceId"
          AND ms."itemVariantId" = smf."itemVariantId"
          AND ms."observedAt" < ${input.observedAt}
        RETURNING
          ms."sourceId" AS "sourceId",
          ${input.sourceCode}::text AS "sourceCode",
          ms."canonicalItemId" AS "canonicalItemId",
          ms."itemVariantId" AS "itemVariantId",
          ms."id" AS "marketStateId",
          ms."latestSnapshotId" AS "latestSnapshotId",
          ms."observedAt" AS "observedAt"
      `,
    );
  }

  async refreshLatestStateHeartbeatForVariants(
    input: RefreshLatestMarketStateHeartbeatForVariantsInput,
  ): Promise<readonly RefreshedMarketStateHeartbeatRecord[]> {
    const uniqueItemVariantIds = [...new Set(input.itemVariantIds)];

    if (uniqueItemVariantIds.length === 0) {
      return [];
    }

    const refreshableStates = await this.prismaService.marketState.findMany({
      where: {
        sourceId: input.sourceId,
        itemVariantId: {
          in: uniqueItemVariantIds,
        },
        observedAt: {
          lt: input.observedAt,
        },
      },
      select: {
        id: true,
        canonicalItemId: true,
        itemVariantId: true,
        latestSnapshotId: true,
      },
    });

    if (refreshableStates.length === 0) {
      return [];
    }

    const refreshedAt = new Date();

    await this.prismaService.marketState.updateMany({
      where: {
        id: {
          in: refreshableStates.map((state) => state.id),
        },
      },
      data: {
        observedAt: input.observedAt,
        lastSyncedAt: refreshedAt,
      },
    });

    return refreshableStates.map((state) => ({
      sourceId: input.sourceId,
      sourceCode: input.sourceCode,
      canonicalItemId: state.canonicalItemId,
      itemVariantId: state.itemVariantId,
      marketStateId: state.id,
      latestSnapshotId: state.latestSnapshotId,
      observedAt: input.observedAt,
    }));
  }

  private buildMarketStateData(
    input: AppendSnapshotAndProjectLatestStateInput,
    now: Date,
  ) {
    return {
      canonicalItemId: input.canonicalItemId,
      currencyCode: input.currencyCode,
      observedAt: input.observedAt,
      lastSyncedAt: now,
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
    };
  }

  private hasSnapshotFieldChange(
    currentState: {
      readonly currencyCode: string;
      readonly lowestAskGross: { toString(): string } | null;
      readonly highestBidGross: { toString(): string } | null;
      readonly lastTradeGross: { toString(): string } | null;
      readonly average24hGross: { toString(): string } | null;
      readonly listingCount: number | null;
      readonly saleCount24h: number | null;
      readonly confidence: { toString(): string } | null;
    },
    input: {
      readonly currencyCode: string;
      readonly lowestAskGross?: { toString(): string } | null;
      readonly highestBidGross?: { toString(): string } | null;
      readonly lastTradeGross?: { toString(): string } | null;
      readonly average24hGross?: { toString(): string } | null;
      readonly listingCount?: number | null;
      readonly saleCount24h?: number | null;
      readonly confidence?: { toString(): string } | null;
    },
  ): boolean {
    if (currentState.currencyCode !== input.currencyCode) {
      return true;
    }

    return (
      this.hasOptionalDecimalChange(
        currentState.lowestAskGross,
        input.lowestAskGross,
      ) ||
      this.hasOptionalDecimalChange(
        currentState.highestBidGross,
        input.highestBidGross,
      ) ||
      this.hasOptionalDecimalChange(
        currentState.lastTradeGross,
        input.lastTradeGross,
      ) ||
      this.hasOptionalDecimalChange(
        currentState.average24hGross,
        input.average24hGross,
      ) ||
      this.hasOptionalNumberChange(currentState.listingCount, input.listingCount) ||
      this.hasOptionalNumberChange(
        currentState.saleCount24h,
        input.saleCount24h,
      ) ||
      this.hasOptionalDecimalChange(currentState.confidence, input.confidence)
    );
  }

  private hasOptionalDecimalChange(
    currentValue: { toString(): string } | null,
    nextValue: { toString(): string } | null | undefined,
  ): boolean {
    if (nextValue === undefined) {
      return false;
    }

    if (currentValue === null) {
      return nextValue !== null;
    }

    if (nextValue === null) {
      return true;
    }

    return currentValue.toString() !== nextValue.toString();
  }

  private hasOptionalNumberChange(
    currentValue: number | null,
    nextValue: number | null | undefined,
  ): boolean {
    if (nextValue === undefined) {
      return false;
    }

    return currentValue !== nextValue;
  }
}
