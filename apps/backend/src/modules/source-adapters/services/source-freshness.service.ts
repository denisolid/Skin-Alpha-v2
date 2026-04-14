import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { NormalizedSourcePayloadDto } from '../dto/normalized-source-payload.dto';
import { SourceRecordService } from './source-record.service';

interface FreshnessThresholds {
  readonly listingStaleMs: number;
  readonly marketStateStaleMs: number;
  readonly heartbeatMissingMs: number;
}

interface VariantFreshnessUpdate {
  readonly canonicalItemId: string;
  readonly itemVariantId: string;
  readonly lastListingObservedAt: Date | undefined;
  readonly lastMarketFactObservedAt: Date | undefined;
}

@Injectable()
export class SourceFreshnessService {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(SourceRecordService)
    private readonly sourceRecordService: SourceRecordService,
  ) {}

  async recordNormalizedPayload(input: NormalizedSourcePayloadDto): Promise<void> {
    const source = await this.sourceRecordService.resolveByKey(input.source);
    const thresholds = this.resolveThresholds(input.source);
    const now = new Date();
    const listingUpdates = new Map<string, VariantFreshnessUpdate>();

    for (const listing of input.listings) {
      if (!listing.canonicalItemId || !listing.itemVariantId) {
        continue;
      }

      const current =
        listingUpdates.get(listing.itemVariantId) ??
        {
          canonicalItemId: listing.canonicalItemId,
          itemVariantId: listing.itemVariantId,
          lastListingObservedAt: undefined,
          lastMarketFactObservedAt: undefined,
        };

      listingUpdates.set(listing.itemVariantId, {
        ...current,
        ...(this.maxDate(current.lastListingObservedAt, listing.observedAt)
          ? {
              lastListingObservedAt: this.maxDate(
                current.lastListingObservedAt,
                listing.observedAt,
              ),
            }
          : {}),
      });
    }

    for (const marketState of input.marketStates) {
      if (!marketState.canonicalItemId || !marketState.itemVariantId) {
        continue;
      }

      const current =
        listingUpdates.get(marketState.itemVariantId) ??
        {
          canonicalItemId: marketState.canonicalItemId,
          itemVariantId: marketState.itemVariantId,
          lastListingObservedAt: undefined,
          lastMarketFactObservedAt: undefined,
        };

      listingUpdates.set(marketState.itemVariantId, {
        ...current,
        ...(this.maxDate(
          current.lastMarketFactObservedAt,
          marketState.capturedAt,
        )
          ? {
              lastMarketFactObservedAt: this.maxDate(
                current.lastMarketFactObservedAt,
                marketState.capturedAt,
              ),
            }
          : {}),
      });
    }

    for (const update of listingUpdates.values()) {
      const freshnessLagSeconds = Math.max(
        0,
        Math.round(
          (now.getTime() -
            this.resolveFreshnessAnchor(update.lastMarketFactObservedAt, update.lastListingObservedAt, input.observedAt).getTime()) /
            1000,
        ),
      );
      const heartbeatMissing =
        now.getTime() - input.observedAt.getTime() > thresholds.heartbeatMissingMs;
      const isListingStale =
        !update.lastListingObservedAt ||
        now.getTime() - update.lastListingObservedAt.getTime() >
          thresholds.listingStaleMs;
      const isMarketStateStale =
        !update.lastMarketFactObservedAt ||
        now.getTime() - update.lastMarketFactObservedAt.getTime() >
          thresholds.marketStateStaleMs;

      await this.prismaService.itemSourceFreshness.upsert({
        where: {
          sourceId_itemVariantId: {
            sourceId: source.id,
            itemVariantId: update.itemVariantId,
          },
        },
        create: {
          sourceId: source.id,
          canonicalItemId: update.canonicalItemId,
          itemVariantId: update.itemVariantId,
          lastRawObservedAt: input.observedAt,
          ...(input.fetchedAt ? { lastRawFetchedAt: input.fetchedAt } : {}),
          ...(input.archivedAt ? { lastRawArchivedAt: input.archivedAt } : {}),
          lastNormalizedAt: input.normalizedAt ?? now,
          ...(update.lastListingObservedAt
            ? { lastListingObservedAt: update.lastListingObservedAt }
            : {}),
          ...(update.lastMarketFactObservedAt
            ? { lastMarketFactObservedAt: update.lastMarketFactObservedAt }
            : {}),
          freshnessLagSeconds,
          isListingStale,
          isMarketStateStale,
          heartbeatMissing,
        },
        update: {
          canonicalItemId: update.canonicalItemId,
          lastRawObservedAt: input.observedAt,
          ...(input.fetchedAt ? { lastRawFetchedAt: input.fetchedAt } : {}),
          ...(input.archivedAt ? { lastRawArchivedAt: input.archivedAt } : {}),
          lastNormalizedAt: input.normalizedAt ?? now,
          ...(update.lastListingObservedAt
            ? { lastListingObservedAt: update.lastListingObservedAt }
            : {}),
          ...(update.lastMarketFactObservedAt
            ? { lastMarketFactObservedAt: update.lastMarketFactObservedAt }
            : {}),
          freshnessLagSeconds,
          isListingStale,
          isMarketStateStale,
          heartbeatMissing,
        },
      });
    }
  }

  async markProjectedMarketStates(input: {
    readonly source: NormalizedSourcePayloadDto['source'];
    readonly marketStates: NormalizedSourcePayloadDto['marketStates'];
    readonly updatedAt: Date;
  }): Promise<void> {
    const source = await this.sourceRecordService.resolveByKey(input.source);
    const thresholds = this.resolveThresholds(input.source);

    for (const marketState of input.marketStates) {
      if (!marketState.canonicalItemId || !marketState.itemVariantId) {
        continue;
      }

      const freshnessLagSeconds = Math.max(
        0,
        Math.round(
          (input.updatedAt.getTime() - marketState.capturedAt.getTime()) / 1000,
        ),
      );
      const isMarketStateStale =
        input.updatedAt.getTime() - marketState.capturedAt.getTime() >
        thresholds.marketStateStaleMs;

      await this.prismaService.itemSourceFreshness.upsert({
        where: {
          sourceId_itemVariantId: {
            sourceId: source.id,
            itemVariantId: marketState.itemVariantId,
          },
        },
        create: {
          sourceId: source.id,
          canonicalItemId: marketState.canonicalItemId,
          itemVariantId: marketState.itemVariantId,
          lastSnapshotObservedAt: marketState.capturedAt,
          lastMarketStateUpdatedAt: input.updatedAt,
          freshnessLagSeconds,
          isMarketStateStale,
          heartbeatMissing: false,
        },
        update: {
          canonicalItemId: marketState.canonicalItemId,
          lastSnapshotObservedAt: marketState.capturedAt,
          lastMarketStateUpdatedAt: input.updatedAt,
          freshnessLagSeconds,
          isMarketStateStale,
          heartbeatMissing: false,
        },
      });
    }
  }

  async refreshMarketStateHeartbeatFromEquivalentArchive(input: {
    readonly source: NormalizedSourcePayloadDto['source'];
    readonly equivalentRawPayloadArchiveId: string;
    readonly observedAt: Date;
    readonly normalizedAt?: Date;
  }): Promise<number> {
    const source = await this.sourceRecordService.resolveByKey(input.source);
    const refreshedAt = input.normalizedAt ?? new Date();

    return this.prismaService.$executeRaw`
      UPDATE "ItemSourceFreshness" AS isf
      SET
        "lastRawObservedAt" = ${input.observedAt},
        "lastNormalizedAt" = ${refreshedAt},
        "lastMarketFactObservedAt" = ${input.observedAt},
        "lastMarketStateUpdatedAt" = ${refreshedAt},
        "freshnessLagSeconds" = 0,
        "isMarketStateStale" = false,
        "heartbeatMissing" = false,
        "updatedAt" = ${refreshedAt}
      FROM "SourceMarketFact" AS smf
      WHERE smf."sourceId" = ${source.id}
        AND smf."rawPayloadArchiveId" = ${input.equivalentRawPayloadArchiveId}
        AND isf."sourceId" = smf."sourceId"
        AND isf."itemVariantId" = smf."itemVariantId"
    `;
  }

  async refreshProjectedMarketStatesHeartbeatForVariants(input: {
    readonly source: NormalizedSourcePayloadDto['source'];
    readonly itemVariantIds: readonly string[];
    readonly observedAt: Date;
    readonly updatedAt?: Date;
  }): Promise<number> {
    const uniqueItemVariantIds = [...new Set(input.itemVariantIds)];

    if (uniqueItemVariantIds.length === 0) {
      return 0;
    }

    const source = await this.sourceRecordService.resolveByKey(input.source);
    const thresholds = this.resolveThresholds(input.source);
    const refreshedAt = input.updatedAt ?? new Date();
    const freshnessLagSeconds = Math.max(
      0,
      Math.round(
        (refreshedAt.getTime() - input.observedAt.getTime()) / 1000,
      ),
    );
    const isMarketStateStale =
      refreshedAt.getTime() - input.observedAt.getTime() >
      thresholds.marketStateStaleMs;

    const result = await this.prismaService.itemSourceFreshness.updateMany({
      where: {
        sourceId: source.id,
        itemVariantId: {
          in: uniqueItemVariantIds,
        },
      },
      data: {
        lastMarketFactObservedAt: input.observedAt,
        lastSnapshotObservedAt: input.observedAt,
        lastMarketStateUpdatedAt: refreshedAt,
        freshnessLagSeconds,
        isMarketStateStale,
        heartbeatMissing: false,
      },
    });

    return result.count;
  }

  private resolveThresholds(
    source: NormalizedSourcePayloadDto['source'],
  ): FreshnessThresholds {
    if (source === 'steam-snapshot' || source === 'backup-aggregator') {
      return {
        listingStaleMs: 30 * 60 * 1000,
        marketStateStaleMs: 45 * 60 * 1000,
        heartbeatMissingMs: 60 * 60 * 1000,
      };
    }

    if (
      source === 'csfloat' ||
      source === 'skinport' ||
      source === 'dmarket' ||
      source === 'waxpeer' ||
      source === 'bitskins'
    ) {
      return {
        listingStaleMs: 10 * 60 * 1000,
        marketStateStaleMs: 15 * 60 * 1000,
        heartbeatMissingMs: 20 * 60 * 1000,
      };
    }

    return {
      listingStaleMs: 20 * 60 * 1000,
      marketStateStaleMs: 30 * 60 * 1000,
      heartbeatMissingMs: 45 * 60 * 1000,
    };
  }

  private resolveFreshnessAnchor(
    marketFactObservedAt: Date | undefined,
    listingObservedAt: Date | undefined,
    fallbackObservedAt: Date,
  ): Date {
    return (
      this.maxDate(marketFactObservedAt, listingObservedAt) ?? fallbackObservedAt
    );
  }

  private maxDate(left?: Date, right?: Date): Date | undefined {
    if (!left) {
      return right;
    }

    if (!right) {
      return left;
    }

    return left.getTime() >= right.getTime() ? left : right;
  }
}
