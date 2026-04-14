import { HealthStatus, ListingStatus } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../infrastructure/config/app-config.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { MarketStateUpdaterService } from '../../market-state/services/market-state-updater.service';
import { UPDATE_MARKET_STATE_QUEUE_NAME } from '../domain/source-ingestion.constants';
import type { NormalizedMarketStateDto } from '../dto/normalized-market-state.dto';
import { IngestionDiagnosticsService } from './ingestion-diagnostics.service';
import { SourceFreshnessService } from './source-freshness.service';
import { SourceRecordService } from './source-record.service';

interface ReconcileAndRebuildInput {
  readonly syncStartedAt: Date;
  readonly observedAt: Date;
  readonly sourceListingIds: readonly string[];
  readonly fullSnapshot: boolean;
  readonly normalizedTitles?: readonly string[];
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
export class CsFloatMarketStateService {
  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(SourceRecordService)
    private readonly sourceRecordService: SourceRecordService,
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
    const source = await this.sourceRecordService.resolveByKey('csfloat');
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

    const staleWhere = input.fullSnapshot
      ? {
          sourceId: source.id,
          listingStatus: ListingStatus.ACTIVE,
          lastSeenAt: {
            lt: input.syncStartedAt,
          },
        }
      : input.normalizedTitles?.length
        ? {
            sourceId: source.id,
            listingStatus: ListingStatus.ACTIVE,
            normalizedTitle: {
              in: input.normalizedTitles.map((title) =>
                this.normalizeTitle(title),
              ),
            },
            lastSeenAt: {
              lt: input.syncStartedAt,
            },
          }
        : null;
    const staleListings = staleWhere
      ? await this.prismaService.sourceListing.findMany({
          where: staleWhere,
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
      },
      orderBy: {
        priceGross: 'asc',
      },
    });
    const activeListingsByVariant = new Map<string, typeof activeListings>();

    for (const listing of activeListings) {
      const currentListings =
        activeListingsByVariant.get(listing.itemVariantId) ?? [];

      currentListings.push(listing);
      activeListingsByVariant.set(listing.itemVariantId, currentListings);
    }

    const marketStates: NormalizedMarketStateDto[] = affectedVariants.map(
      (variant) => {
        const listings =
          activeListingsByVariant.get(variant.itemVariantId) ?? [];
        const prices = listings.map((listing) =>
          Math.round(Number(listing.priceGross.toString()) * 100),
        );
        const sortedPrices = [...prices].sort((left, right) => left - right);
        const medianAskMinor =
          sortedPrices.length === 0
            ? undefined
            : sortedPrices[Math.floor(sortedPrices.length / 2)];

        return {
          source: 'csfloat',
          canonicalItemId: variant.canonicalItemId,
          itemVariantId: variant.itemVariantId,
          capturedAt: input.observedAt,
          currency: variant.currencyCode || this.configService.csfloatCurrency,
          listingCount: listings.length,
          ...(sortedPrices[0] !== undefined
            ? { lowestAskMinor: sortedPrices[0] }
            : {}),
          ...(medianAskMinor !== undefined ? { medianAskMinor } : {}),
          confidence:
            listings.length > 0 ? this.deriveConfidence(listings.length) : 0,
          liquidityScore:
            listings.length > 0
              ? this.deriveLiquidityScore(listings.length)
              : 0,
          metadata: {
            aggregatedFrom: 'stored-source-listings',
            listingCount: listings.length,
          },
        };
      },
    );

    const projectionStartedAt = Date.now();
    const projectionResult =
      await this.marketStateUpdaterService.updateLatestStateBatch({
        source: 'csfloat',
        marketStates,
      });
    await this.sourceFreshnessService.markProjectedMarketStates({
      source: 'csfloat',
      marketStates,
      updatedAt: new Date(),
    });
    await this.ingestionDiagnosticsService.recordStageMetric({
      source: 'csfloat',
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

  private deriveConfidence(volume: number): number {
    // Single observed listings are still actionable market signals; give them
    // a meaningful base confidence and then scale upward with listing depth.
    return Math.min(0.94, 0.5 + Math.log10(volume + 1) / 4);
  }

  private deriveLiquidityScore(quantity: number): number {
    return Math.min(1, Math.log10(quantity + 1) / 2);
  }

  private normalizeTitle(title: string): string {
    return title.trim().replace(/\s+/g, ' ');
  }
}
