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
export class DMarketMarketStateService {
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
    const source = await this.sourceRecordService.resolveByKey('dmarket');
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
        const sortedPrices = [...prices].sort((left, right) => left - right);
        const anchorPrices = listings
          .map((listing) => this.extractAnchorPriceMinor(listing.attributes))
          .filter((value): value is number => value !== undefined)
          .sort((left, right) => left - right);
        const medianAskMinor =
          sortedPrices.length === 0
            ? undefined
            : sortedPrices[Math.floor(sortedPrices.length / 2)];
        const anchorMedianMinor =
          anchorPrices.length === 0
            ? undefined
            : anchorPrices[Math.floor(anchorPrices.length / 2)];
        const average24hMinor =
          prices.length === 0
            ? undefined
            : Math.round(
                prices.reduce((total, price) => total + price, 0) /
                  Math.max(1, prices.length),
              );

        return {
          source: 'dmarket',
          canonicalItemId: variant.canonicalItemId,
          itemVariantId: variant.itemVariantId,
          capturedAt: input.observedAt,
          currency: variant.currencyCode || this.configService.dmarketCurrency,
          listingCount: listings.length,
          ...(sortedPrices[0] !== undefined
            ? { lowestAskMinor: sortedPrices[0] }
            : {}),
          ...(medianAskMinor !== undefined ? { medianAskMinor } : {}),
          ...(average24hMinor !== undefined ? { average24hMinor } : {}),
          ...(anchorMedianMinor !== undefined
            ? { lastTradeMinor: anchorMedianMinor }
            : {}),
          confidence:
            listings.length > 0
              ? this.deriveConfidence(listings.length, anchorPrices.length)
              : 0,
          liquidityScore:
            listings.length > 0
              ? this.deriveLiquidityScore(listings.length)
              : 0,
          metadata: {
            aggregatedFrom: 'stored-source-listings',
            listingCount: listings.length,
            anchorCount: anchorPrices.length,
          },
        };
      },
    );

    const projectionStartedAt = Date.now();
    const projectionResult =
      await this.marketStateUpdaterService.updateLatestStateBatch({
        source: 'dmarket',
        marketStates,
      });

    await this.sourceFreshnessService.markProjectedMarketStates({
      source: 'dmarket',
      marketStates,
      updatedAt: new Date(),
    });
    await this.ingestionDiagnosticsService.recordStageMetric({
      source: 'dmarket',
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
        source: 'dmarket',
        itemVariantIds,
        observedAt: input.observedAt,
      },
    );
    const refreshedCount =
      await this.marketStateUpdaterService.refreshLatestStateHeartbeatForVariants(
        {
          source: 'dmarket',
          itemVariantIds,
          observedAt: input.observedAt,
        },
      );

    await this.sourceFreshnessService.refreshProjectedMarketStatesHeartbeatForVariants(
      {
        source: 'dmarket',
        itemVariantIds,
        observedAt: input.observedAt,
        ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
      },
    );

    return refreshedCount;
  }

  private deriveConfidence(volume: number, anchorCount: number): number {
    const baseConfidence = Math.min(0.92, 0.46 + Math.log10(volume + 1) / 4);
    const anchorBoost = Math.min(0.08, anchorCount / Math.max(1, volume) / 4);

    return Number(Math.min(0.96, baseConfidence + anchorBoost).toFixed(4));
  }

  private deriveLiquidityScore(quantity: number): number {
    return Number(Math.min(1, Math.log10(quantity + 1) / 2).toFixed(4));
  }

  private extractAnchorPriceMinor(attributes: unknown): number | undefined {
    if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) {
      return undefined;
    }

    const metadata = (attributes as Record<string, unknown>).metadata;

    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return undefined;
    }

    const record = metadata as Record<string, unknown>;
    const candidates = [
      record.suggestedPriceUsd,
      this.readNested(record.recommendedPrice, ['d7', 'USD']),
      this.readNested(record.recommendedPrice, ['d7Plus', 'USD']),
      record.instantPriceUsd,
    ];

    for (const candidate of candidates) {
      if (typeof candidate !== 'string' || candidate.trim().length === 0) {
        continue;
      }

      const normalized = candidate.trim();

      if (normalized.includes('.')) {
        const parsed = Number(normalized);

        if (Number.isFinite(parsed)) {
          return Math.round(parsed * 100);
        }
      } else {
        const parsed = Number(normalized);

        if (Number.isFinite(parsed)) {
          return Math.round(parsed);
        }
      }
    }

    return undefined;
  }

  private readNested(value: unknown, path: readonly string[]): unknown {
    let current: unknown = value;

    for (const segment of path) {
      if (
        !current ||
        typeof current !== 'object' ||
        Array.isArray(current) ||
        !(segment in (current as Record<string, unknown>))
      ) {
        return undefined;
      }

      current = (current as Record<string, unknown>)[segment];
    }

    return current;
  }
}
