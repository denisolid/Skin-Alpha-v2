import { HealthStatus, ListingStatus } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../infrastructure/config/app-config.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { MarketStateUpdaterService } from '../../market-state/services/market-state-updater.service';
import { UPDATE_MARKET_STATE_QUEUE_NAME } from '../domain/source-ingestion.constants';
import type { NormalizedMarketStateDto } from '../dto/normalized-market-state.dto';
import { IngestionDiagnosticsService } from './ingestion-diagnostics.service';
import { SourceFreshnessService } from './source-freshness.service';
import { SourceListingStorageService } from './source-listing-storage.service';
import { SourceRecordService } from './source-record.service';

interface ReconcileAndRebuildInput {
  readonly syncStartedAt: Date;
  readonly observedAt: Date;
  readonly sourceListingIds: readonly string[];
  readonly targetItemVariantIds: readonly string[];
}

interface AffectedVariantContext {
  readonly canonicalItemId: string;
  readonly itemVariantId: string;
  readonly currencyCode: string;
}

interface ReconcileAndRebuildResult {
  readonly removedCount: number;
  readonly rebuiltStateCount: number;
}

@Injectable()
export class BitSkinsMarketStateService {
  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(SourceRecordService)
    private readonly sourceRecordService: SourceRecordService,
    @Inject(SourceListingStorageService)
    private readonly sourceListingStorageService: SourceListingStorageService,
    @Inject(MarketStateUpdaterService)
    private readonly marketStateUpdaterService: MarketStateUpdaterService,
    @Inject(SourceFreshnessService)
    private readonly sourceFreshnessService: SourceFreshnessService,
    @Inject(IngestionDiagnosticsService)
    private readonly ingestionDiagnosticsService: IngestionDiagnosticsService,
  ) {}

  async reconcileAndRebuild(
    input: ReconcileAndRebuildInput,
  ): Promise<ReconcileAndRebuildResult> {
    const source = await this.sourceRecordService.resolveByKey('bitskins');
    const targetItemVariantIds = [...new Set(input.targetItemVariantIds)];
    const touchedListings = input.sourceListingIds.length
      ? await this.prismaService.sourceListing.findMany({
          where: {
            id: {
              in: [...input.sourceListingIds],
            },
          },
          select: {
            canonicalItemId: true,
            itemVariantId: true,
            currencyCode: true,
          },
        })
      : [];
    const staleListings = targetItemVariantIds.length
      ? await this.prismaService.sourceListing.findMany({
          where: {
            sourceId: source.id,
            listingStatus: ListingStatus.ACTIVE,
            itemVariantId: {
              in: targetItemVariantIds,
            },
            lastSeenAt: {
              lt: input.syncStartedAt,
            },
          },
          select: {
            id: true,
            canonicalItemId: true,
            itemVariantId: true,
            currencyCode: true,
          },
        })
      : [];

    if (staleListings.length > 0) {
      await this.prismaService.sourceListing.updateMany({
        where: {
          id: {
            in: staleListings.map((listing) => listing.id),
          },
        },
        data: {
          listingStatus: ListingStatus.REMOVED,
          expiresAt: input.observedAt,
        },
      });
    }

    const contextsByVariant = new Map<string, AffectedVariantContext>();

    for (const listing of [...touchedListings, ...staleListings]) {
      if (!contextsByVariant.has(listing.itemVariantId)) {
        contextsByVariant.set(listing.itemVariantId, {
          canonicalItemId: listing.canonicalItemId,
          itemVariantId: listing.itemVariantId,
          currencyCode: listing.currencyCode,
        });
      }
    }

    if (contextsByVariant.size === 0 && targetItemVariantIds.length > 0) {
      const existingVariants = await this.prismaService.sourceListing.findMany({
        where: {
          sourceId: source.id,
          itemVariantId: {
            in: targetItemVariantIds,
          },
        },
        select: {
          canonicalItemId: true,
          itemVariantId: true,
          currencyCode: true,
        },
        distinct: ['itemVariantId'],
      });

      for (const listing of existingVariants) {
        contextsByVariant.set(listing.itemVariantId, {
          canonicalItemId: listing.canonicalItemId,
          itemVariantId: listing.itemVariantId,
          currencyCode: listing.currencyCode,
        });
      }
    }

    const affectedVariants = [...contextsByVariant.values()];

    if (affectedVariants.length === 0) {
      return {
        removedCount: staleListings.length,
        rebuiltStateCount: 0,
      };
    }

    const activeListings = await this.prismaService.sourceListing.findMany({
      where: {
        sourceId: source.id,
        listingStatus: ListingStatus.ACTIVE,
        itemVariantId: {
          in: affectedVariants.map((variant) => variant.itemVariantId),
        },
      },
      select: {
        canonicalItemId: true,
        itemVariantId: true,
        currencyCode: true,
        priceGross: true,
        quantityAvailable: true,
        attributes: true,
      },
      orderBy: {
        priceGross: 'asc',
      },
    });
    const activeListingsByVariant = new Map<string, typeof activeListings>();

    for (const listing of activeListings) {
      const listings = activeListingsByVariant.get(listing.itemVariantId) ?? [];

      listings.push(listing);
      activeListingsByVariant.set(listing.itemVariantId, listings);
    }

    const marketStates: NormalizedMarketStateDto[] = affectedVariants.map(
      (variant) => {
        const listings =
          activeListingsByVariant.get(variant.itemVariantId) ?? [];
        const prices = listings.map((listing) =>
          Math.round(Number(listing.priceGross.toString()) * 100),
        );
        const totalQuantity = listings.reduce(
          (sum, listing) => sum + Math.max(0, listing.quantityAvailable),
          0,
        );
        const weightedAverageMinor =
          listings.length === 0
            ? undefined
            : Math.round(
                listings.reduce(
                  (sum, listing) =>
                    sum +
                    (this.extractAveragePriceMinor(listing.attributes) ??
                      Math.round(Number(listing.priceGross.toString()) * 100)) *
                      Math.max(1, listing.quantityAvailable),
                  0,
                ) / Math.max(1, totalQuantity || listings.length),
              );
        const averageAnchorCount = listings.filter(
          (listing) =>
            this.extractAveragePriceMinor(listing.attributes) !== undefined,
        ).length;

        return {
          source: 'bitskins',
          canonicalItemId: variant.canonicalItemId,
          itemVariantId: variant.itemVariantId,
          capturedAt: input.observedAt,
          currency:
            variant.currencyCode || this.configService.bitskinsCurrency,
          listingCount: totalQuantity,
          ...(prices.length > 0 ? { lowestAskMinor: Math.min(...prices) } : {}),
          ...(weightedAverageMinor !== undefined
            ? { average24hMinor: weightedAverageMinor }
            : {}),
          ...(weightedAverageMinor !== undefined
            ? { lastTradeMinor: weightedAverageMinor }
            : {}),
          sampleSize: listings.length,
          confidence:
            totalQuantity > 0
              ? this.deriveConfidence(totalQuantity, averageAnchorCount)
              : 0,
          liquidityScore:
            totalQuantity > 0 ? this.deriveLiquidityScore(totalQuantity) : 0,
          metadata: {
            aggregatedFrom: 'stored-source-listings',
            listingRows: listings.length,
            quantityTotal: totalQuantity,
            averageAnchorCount,
          },
        };
      },
    );

    const projectionStartedAt = Date.now();
    const projectionResult =
      await this.marketStateUpdaterService.updateLatestStateBatch({
        source: 'bitskins',
        marketStates,
      });

    await this.sourceFreshnessService.markProjectedMarketStates({
      source: 'bitskins',
      marketStates,
      updatedAt: new Date(),
    });
    await this.ingestionDiagnosticsService.recordStageMetric({
      source: 'bitskins',
      stage: UPDATE_MARKET_STATE_QUEUE_NAME,
      status:
        projectionResult.skippedCount > 0
          ? HealthStatus.DEGRADED
          : HealthStatus.OK,
      latencyMs: Date.now() - projectionStartedAt,
      details: {
        snapshotCount: projectionResult.snapshotCount,
        upsertedStateCount: projectionResult.upsertedStateCount,
        skippedCount: projectionResult.skippedCount,
        unchangedProjectionSkipCount:
          projectionResult.unchangedProjectionSkipCount,
      },
    });

    return {
      removedCount: staleListings.length,
      rebuiltStateCount: marketStates.length,
    };
  }

  async refreshHeartbeatForVariants(input: {
    readonly itemVariantIds: readonly string[];
    readonly observedAt: Date;
    readonly updatedAt?: Date;
  }): Promise<number> {
    const itemVariantIds = [...new Set(input.itemVariantIds)];

    if (itemVariantIds.length === 0) {
      return 0;
    }

    await this.sourceListingStorageService.refreshActiveListingsHeartbeatForVariants(
      {
        source: 'bitskins',
        itemVariantIds,
        observedAt: input.observedAt,
      },
    );
    const refreshedCount =
      await this.marketStateUpdaterService.refreshLatestStateHeartbeatForVariants(
        {
          source: 'bitskins',
          itemVariantIds,
          observedAt: input.observedAt,
        },
      );

    await this.sourceFreshnessService.refreshProjectedMarketStatesHeartbeatForVariants(
      {
        source: 'bitskins',
        itemVariantIds,
        observedAt: input.observedAt,
        ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
      },
    );

    return refreshedCount;
  }

  private deriveConfidence(quantity: number, averageAnchorCount: number): number {
    const baseConfidence = Math.min(0.9, 0.42 + Math.log10(quantity + 1) / 4.5);
    const anchorBoost = Math.min(0.08, averageAnchorCount / 10);

    return Number(Math.min(0.94, baseConfidence + anchorBoost).toFixed(4));
  }

  private deriveLiquidityScore(quantity: number): number {
    return Number(Math.min(1, Math.log10(quantity + 1) / 2).toFixed(4));
  }

  private extractAveragePriceMinor(attributes: unknown): number | undefined {
    if (
      !attributes ||
      typeof attributes !== 'object' ||
      Array.isArray(attributes)
    ) {
      return undefined;
    }

    const metadata = (attributes as Record<string, unknown>).metadata;

    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return undefined;
    }

    const candidate = (metadata as Record<string, unknown>).priceAvgMinor;

    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return Math.round(candidate);
    }

    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      const parsed = Number(candidate);

      return Number.isFinite(parsed) ? Math.round(parsed) : undefined;
    }

    return undefined;
  }
}
