import { Inject, Injectable, Optional } from '@nestjs/common';

import { AppLoggerService } from '../../../infrastructure/logging/app-logger.service';
import { CatalogAliasNormalizationService } from '../../catalog/services/catalog-alias-normalization.service';
import type { CatalogResolutionDto } from '../../catalog/dto/catalog-resolution.dto';
import {
  chunkArray,
  mapWithConcurrencyLimit,
} from '../../shared/utils/async.util';
import type { ArchivedRawPayloadDto } from '../dto/archived-raw-payload.dto';
import type { NormalizedMarketListingDto } from '../dto/normalized-market-listing.dto';
import type { NormalizedMarketStateDto } from '../dto/normalized-market-state.dto';
import type { NormalizedSourcePayloadDto } from '../dto/normalized-source-payload.dto';
import type { SkinportItemSnapshotDto } from '../dto/skinport-item-snapshot.dto';
import type { SkinportSaleFeedEventDto } from '../dto/skinport-sale-feed-event.dto';
import type { SkinportSalesHistoryDto } from '../dto/skinport-sales-history.dto';
import type {
  ResolveSkinportListingInput,
  SkinportCatalogBatchResolutionStats,
  SkinportCatalogLinkerRunContext,
} from './skinport-catalog-linker.service';
import { SkinportCatalogLinkerService } from './skinport-catalog-linker.service';

interface SkinportFilterBucket {
  count: number;
  sampleNames: string[];
}

interface SkinportSnapshotChunkResult {
  readonly listings: readonly NormalizedMarketListingDto[];
  readonly marketStates: readonly NormalizedMarketStateDto[];
  readonly warnings: readonly string[];
  readonly filterBuckets: ReadonlyMap<string, SkinportFilterBucket>;
  readonly batchStats: SkinportCatalogBatchResolutionStats;
  readonly durationMs: number;
}

const SKINPORT_SNAPSHOT_CHUNK_SIZE = 500;
const SKINPORT_SNAPSHOT_DB_CONCURRENCY = 1;

@Injectable()
export class SkinportPayloadNormalizerService {
  constructor(
    @Inject(AppLoggerService)
    private readonly logger: AppLoggerService,
    @Inject(SkinportCatalogLinkerService)
    private readonly skinportCatalogLinkerService: SkinportCatalogLinkerService,
    @Optional()
    @Inject(CatalogAliasNormalizationService)
    private readonly aliasNormalizationService: CatalogAliasNormalizationService = new CatalogAliasNormalizationService(),
  ) {}

  async normalize(
    archive: ArchivedRawPayloadDto,
  ): Promise<NormalizedSourcePayloadDto> {
    if (archive.endpointName === 'skinport-items-snapshot') {
      return this.normalizeItemSnapshot(archive);
    }

    if (archive.endpointName === 'skinport-sales-history') {
      return this.normalizeSalesHistorySnapshot(archive);
    }

    if (archive.endpointName === 'skinport-sale-feed') {
      return this.normalizeSaleFeedEvent(archive);
    }

    return {
      rawPayloadArchiveId: archive.id,
      source: archive.source,
      endpointName: archive.endpointName,
      observedAt: archive.observedAt,
      payloadHash: archive.payloadHash,
      listings: [],
      marketStates: [],
      warnings: [`Unsupported Skinport endpoint ${archive.endpointName}.`],
    };
  }

  private async normalizeItemSnapshot(
    archive: ArchivedRawPayloadDto,
  ): Promise<NormalizedSourcePayloadDto> {
    const payload = Array.isArray(archive.payload)
      ? (archive.payload as SkinportItemSnapshotDto[])
      : [];
    const runContext = this.skinportCatalogLinkerService.createRunContext();
    const itemChunks = chunkArray(payload, SKINPORT_SNAPSHOT_CHUNK_SIZE);
    const chunkResults = await mapWithConcurrencyLimit(
      itemChunks,
      SKINPORT_SNAPSHOT_DB_CONCURRENCY,
      async (chunk, chunkIndex) =>
        this.normalizeItemSnapshotChunk({
          archive,
          chunk,
          chunkIndex,
          chunkCount: itemChunks.length,
          runContext,
        }),
    );
    const listings = chunkResults.flatMap((result) => [...result.listings]);
    const marketStates = chunkResults.flatMap((result) => [...result.marketStates]);
    const warnings = chunkResults.flatMap((result) => [...result.warnings]);
    const filterBuckets = new Map<string, SkinportFilterBucket>();
    const aggregateBatchStats = {
      batchSize: 0,
      uniqueListingKeys: 0,
      cacheHits: 0,
      resolvedCount: 0,
      unresolvedCount: 0,
      createdCount: 0,
      reusedCount: 0,
      updatedCount: 0,
    } satisfies SkinportCatalogBatchResolutionStats;

    for (const chunkResult of chunkResults) {
      this.mergeFilterBuckets(filterBuckets, chunkResult.filterBuckets);
      aggregateBatchStats.batchSize += chunkResult.batchStats.batchSize;
      aggregateBatchStats.uniqueListingKeys +=
        chunkResult.batchStats.uniqueListingKeys;
      aggregateBatchStats.cacheHits += chunkResult.batchStats.cacheHits;
      aggregateBatchStats.resolvedCount += chunkResult.batchStats.resolvedCount;
      aggregateBatchStats.unresolvedCount +=
        chunkResult.batchStats.unresolvedCount;
      aggregateBatchStats.createdCount += chunkResult.batchStats.createdCount;
      aggregateBatchStats.reusedCount += chunkResult.batchStats.reusedCount;
      aggregateBatchStats.updatedCount += chunkResult.batchStats.updatedCount;
    }

    this.logger.log(
      `Skinport ${archive.endpointName} (${archive.id}) extracted ${listings.length} listings, filtered ${payload.length - listings.length} listing candidates, and produced ${marketStates.length} market states. batchSize=${aggregateBatchStats.batchSize} uniqueListingKeys=${aggregateBatchStats.uniqueListingKeys} createdCatalogMappings=${aggregateBatchStats.createdCount} reusedCatalogMappings=${aggregateBatchStats.reusedCount} updatedCatalogMappings=${aggregateBatchStats.updatedCount} unresolvedCatalogMappings=${aggregateBatchStats.unresolvedCount} cacheHits=${aggregateBatchStats.cacheHits}. Filter reasons: ${JSON.stringify(this.serializeFilterBuckets(filterBuckets))}.`,
      SkinportPayloadNormalizerService.name,
    );

    return {
      rawPayloadArchiveId: archive.id,
      source: archive.source,
      endpointName: archive.endpointName,
      observedAt: archive.observedAt,
      payloadHash: archive.payloadHash,
      listings,
      marketStates,
      warnings,
    };
  }

  private async normalizeSalesHistorySnapshot(
    archive: ArchivedRawPayloadDto,
  ): Promise<NormalizedSourcePayloadDto> {
    const payload = Array.isArray(archive.payload)
      ? (archive.payload as SkinportSalesHistoryDto[])
      : [];
    const marketStates: NormalizedMarketStateDto[] = [];
    const warnings: string[] = [];
    const filterBuckets = new Map<string, SkinportFilterBucket>();
    const resolutionBatch =
      await this.skinportCatalogLinkerService.resolveOrCreateMany(
        payload.map((item) => ({
          marketHashName: item.market_hash_name,
          ...(item.version !== undefined ? { version: item.version } : {}),
        })),
        this.skinportCatalogLinkerService.createRunContext(),
      );

    for (const item of payload) {
      const linkedItem = this.readCatalogResolution(
        resolutionBatch.resolutions,
        item.market_hash_name,
        item.version,
      );

      if (
        linkedItem.status !== 'resolved' ||
        !linkedItem.canonicalItemId ||
        !linkedItem.itemVariantId
      ) {
        this.recordFilterReason(
          filterBuckets,
          'unresolved_catalog',
          item.market_hash_name,
        );
        warnings.push(
          this.buildUnresolvedWarning(item.market_hash_name, linkedItem),
        );
        continue;
      }

      marketStates.push({
        source: archive.source,
        canonicalItemId: linkedItem.canonicalItemId,
        itemVariantId: linkedItem.itemVariantId,
        capturedAt: archive.observedAt,
        currency: item.currency,
        saleCount24h: item.last_24_hours.volume,
        sampleSize: item.last_7_days.volume,
        confidence: this.deriveConfidence(item.last_24_hours.volume),
        liquidityScore: this.deriveLiquidityScore(item.last_24_hours.volume),
        metadata: {
          itemPage: item.item_page,
          marketPage: item.market_page,
          version: item.version,
          last7Days: item.last_7_days,
          last30Days: item.last_30_days,
          last90Days: item.last_90_days,
        },
        ...(item.last_24_hours.avg !== null
          ? { average24hMinor: this.priceToMinor(item.last_24_hours.avg) }
          : {}),
        ...(item.last_24_hours.median !== null
          ? { lastTradeMinor: this.priceToMinor(item.last_24_hours.median) }
          : {}),
      });
    }

    this.logger.log(
      `Skinport ${archive.endpointName} (${archive.id}) produced ${marketStates.length} market states from ${payload.length} records. batchSize=${resolutionBatch.stats.batchSize} uniqueListingKeys=${resolutionBatch.stats.uniqueListingKeys} createdCatalogMappings=${resolutionBatch.stats.createdCount} reusedCatalogMappings=${resolutionBatch.stats.reusedCount} updatedCatalogMappings=${resolutionBatch.stats.updatedCount} unresolvedCatalogMappings=${resolutionBatch.stats.unresolvedCount}. Filter reasons: ${JSON.stringify(this.serializeFilterBuckets(filterBuckets))}.`,
      SkinportPayloadNormalizerService.name,
    );

    return {
      rawPayloadArchiveId: archive.id,
      source: archive.source,
      endpointName: archive.endpointName,
      observedAt: archive.observedAt,
      payloadHash: archive.payloadHash,
      listings: [],
      marketStates,
      warnings,
    };
  }

  private async normalizeSaleFeedEvent(
    archive: ArchivedRawPayloadDto,
  ): Promise<NormalizedSourcePayloadDto> {
    const payload = this.isSaleFeedEvent(archive.payload)
      ? archive.payload
      : null;

    if (!payload || payload.eventType !== 'listed') {
      return {
        rawPayloadArchiveId: archive.id,
        source: archive.source,
        endpointName: archive.endpointName,
        observedAt: archive.observedAt,
        payloadHash: archive.payloadHash,
        listings: [],
        marketStates: [],
        warnings: [
          'Skinport websocket events are archived for side-channel ingestion only; cached market state remains the scanner source of truth.',
        ],
      };
    }

    const listings: NormalizedMarketListingDto[] = [];
    const warnings: string[] = [];
    const filterBuckets = new Map<string, SkinportFilterBucket>();
    const resolutionBatch =
      await this.skinportCatalogLinkerService.resolveOrCreateMany(
        payload.sales.map((sale) => ({
          marketHashName: sale.marketHashName,
          ...(sale.version !== undefined ? { version: sale.version } : {}),
        })),
        this.skinportCatalogLinkerService.createRunContext(),
      );

    for (const sale of payload.sales) {
      const linkedItem = this.readCatalogResolution(
        resolutionBatch.resolutions,
        sale.marketHashName,
        sale.version,
      );

      if (
        linkedItem.status !== 'resolved' ||
        !linkedItem.canonicalItemId ||
        !linkedItem.itemVariantId
      ) {
        this.recordFilterReason(
          filterBuckets,
          'unresolved_catalog',
          sale.marketHashName,
        );
        warnings.push(
          this.buildUnresolvedWarning(sale.marketHashName, linkedItem),
        );
        continue;
      }

      listings.push({
        source: archive.source,
        externalListingId: `skinport:sale-feed:${sale.saleId}`,
        sourceItemId: String(sale.itemId),
        canonicalItemId: linkedItem.canonicalItemId,
        itemVariantId: linkedItem.itemVariantId,
        title: this.aliasNormalizationService.normalizeMarketHashName(
          sale.marketHashName,
        ),
        observedAt: archive.observedAt,
        currency: sale.currency,
        priceMinor: sale.salePrice,
        quantityAvailable: 1,
        isStatTrak: linkedItem.mapping.stattrak,
        isSouvenir: linkedItem.mapping.souvenir,
        metadata: {
          eventType: payload.eventType,
          productId: sale.productId,
          version: sale.version,
          versionType: sale.versionType,
        },
        ...(sale.url ? { listingUrl: sale.url } : {}),
        ...(sale.pattern !== undefined ? { paintSeed: sale.pattern } : {}),
        ...(sale.wear !== undefined ? { wearFloat: sale.wear } : {}),
      });
    }
    this.logger.log(
      `Skinport ${archive.endpointName} (${archive.id}) extracted ${listings.length} websocket listings from ${payload.sales.length} sale-feed events. batchSize=${resolutionBatch.stats.batchSize} uniqueListingKeys=${resolutionBatch.stats.uniqueListingKeys} createdCatalogMappings=${resolutionBatch.stats.createdCount} reusedCatalogMappings=${resolutionBatch.stats.reusedCount} updatedCatalogMappings=${resolutionBatch.stats.updatedCount} unresolvedCatalogMappings=${resolutionBatch.stats.unresolvedCount}. Filter reasons: ${JSON.stringify(this.serializeFilterBuckets(filterBuckets))}.`,
      SkinportPayloadNormalizerService.name,
    );

    return {
      rawPayloadArchiveId: archive.id,
      source: archive.source,
      endpointName: archive.endpointName,
      observedAt: archive.observedAt,
      payloadHash: archive.payloadHash,
      listings,
      marketStates: [],
      warnings: [
        'Skinport websocket sale feed is ingested asynchronously and does not replace cached snapshot market state.',
        ...warnings,
      ],
    };
  }

  private async normalizeItemSnapshotChunk(input: {
    readonly archive: ArchivedRawPayloadDto;
    readonly chunk: readonly SkinportItemSnapshotDto[];
    readonly chunkIndex: number;
    readonly chunkCount: number;
    readonly runContext: SkinportCatalogLinkerRunContext;
  }): Promise<SkinportSnapshotChunkResult> {
    const startedAt = Date.now();
    const listings: NormalizedMarketListingDto[] = [];
    const marketStates: NormalizedMarketStateDto[] = [];
    const warnings: string[] = [];
    const filterBuckets = new Map<string, SkinportFilterBucket>();
    const resolutionBatch =
      await this.skinportCatalogLinkerService.resolveOrCreateMany(
        input.chunk.map(
          (item): ResolveSkinportListingInput => ({
            marketHashName: item.market_hash_name,
          }),
        ),
        input.runContext,
      );

    for (const item of input.chunk) {
      const linkedItem = this.readCatalogResolution(
        resolutionBatch.resolutions,
        item.market_hash_name,
      );

      if (
        linkedItem.status !== 'resolved' ||
        !linkedItem.canonicalItemId ||
        !linkedItem.itemVariantId
      ) {
        this.recordFilterReason(
          filterBuckets,
          'unresolved_catalog',
          item.market_hash_name,
        );
        warnings.push(
          this.buildUnresolvedWarning(item.market_hash_name, linkedItem),
        );
        continue;
      }

      if (item.quantity <= 0) {
        this.recordFilterReason(
          filterBuckets,
          'non_positive_quantity',
          item.market_hash_name,
        );
      } else if (item.min_price === null) {
        this.recordFilterReason(
          filterBuckets,
          'missing_min_price',
          item.market_hash_name,
        );
      } else {
        listings.push({
          source: input.archive.source,
          externalListingId: `skinport:items:${item.market_hash_name}`,
          sourceItemId: item.market_hash_name,
          canonicalItemId: linkedItem.canonicalItemId,
          itemVariantId: linkedItem.itemVariantId,
          title: this.aliasNormalizationService.normalizeMarketHashName(
            item.market_hash_name,
          ),
          observedAt: input.archive.observedAt,
          currency: item.currency,
          listingUrl: item.market_page,
          priceMinor: this.priceToMinor(
            item.min_price ?? item.suggested_price ?? 0,
          ),
          quantityAvailable: item.quantity,
          isStatTrak: linkedItem.mapping.stattrak,
          isSouvenir: linkedItem.mapping.souvenir,
          metadata: {
            itemPage: item.item_page,
            marketPage: item.market_page,
            minPrice: item.min_price,
            maxPrice: item.max_price,
            meanPrice: item.mean_price,
            suggestedPrice: item.suggested_price,
          },
        });
      }

      marketStates.push({
        source: input.archive.source,
        canonicalItemId: linkedItem.canonicalItemId,
        itemVariantId: linkedItem.itemVariantId,
        capturedAt: input.archive.observedAt,
        currency: item.currency,
        listingCount: item.quantity,
        confidence: this.deriveSnapshotConfidence(
          item.quantity,
          item.min_price !== null,
        ),
        liquidityScore: this.deriveLiquidityScore(item.quantity),
        metadata: {
          itemPage: item.item_page,
          marketPage: item.market_page,
          updatedAt: item.updated_at,
        },
        ...(item.min_price !== null
          ? { lowestAskMinor: this.priceToMinor(item.min_price) }
          : {}),
        ...(item.median_price !== null
          ? { medianAskMinor: this.priceToMinor(item.median_price) }
          : {}),
      });
    }

    const durationMs = Date.now() - startedAt;

    this.logger.log(
      `Skinport ${input.archive.endpointName} (${input.archive.id}) chunk=${input.chunkIndex + 1}/${input.chunkCount} batchSize=${resolutionBatch.stats.batchSize} uniqueListingKeys=${resolutionBatch.stats.uniqueListingKeys} createdCatalogMappings=${resolutionBatch.stats.createdCount} reusedCatalogMappings=${resolutionBatch.stats.reusedCount} updatedCatalogMappings=${resolutionBatch.stats.updatedCount} unresolvedCatalogMappings=${resolutionBatch.stats.unresolvedCount} durationMs=${durationMs}.`,
      SkinportPayloadNormalizerService.name,
    );

    return {
      listings,
      marketStates,
      warnings,
      filterBuckets,
      batchStats: resolutionBatch.stats,
      durationMs,
    };
  }

  private readCatalogResolution(
    resolutions: ReadonlyMap<string, CatalogResolutionDto>,
    marketHashName: string,
    version?: string | null,
  ): CatalogResolutionDto {
    const resolution = resolutions.get(
      this.buildResolutionKey(marketHashName, version),
    );

    if (!resolution) {
      throw new Error(
        `Skinport catalog batch did not return a resolution for "${marketHashName}"${version ? ` (${version})` : ''}.`,
      );
    }

    return resolution;
  }

  private buildResolutionKey(
    marketHashName: string,
    version?: string | null,
  ): string {
    return `${marketHashName}::${version ?? ''}`;
  }

  private buildUnresolvedWarning(
    marketHashName: string,
    resolution: {
      readonly confidence: number;
      readonly reason?: string;
      readonly warnings: readonly string[];
    },
  ): string {
    return `Skinport catalog resolver left "${marketHashName}" unresolved at confidence ${resolution.confidence.toFixed(2)}${resolution.reason ? ` (${resolution.reason})` : ''}${resolution.warnings.length > 0 ? `: ${resolution.warnings.join('; ')}` : '.'}`;
  }

  private deriveConfidence(volume: number): number {
    return Math.min(1, Math.log10(volume + 1) / 2);
  }

  private deriveSnapshotConfidence(
    quantity: number,
    hasAskSignal: boolean,
  ): number {
    if (!hasAskSignal || quantity <= 0) {
      return 0;
    }

    return Math.min(0.95, 0.5 + Math.log10(quantity + 1) / 4);
  }

  private deriveLiquidityScore(quantity: number): number {
    return Math.min(1, Math.log10(quantity + 1) / 2);
  }

  private priceToMinor(value: number): number {
    return Math.round(value * 100);
  }

  private isSaleFeedEvent(value: unknown): value is SkinportSaleFeedEventDto {
    return (
      typeof value === 'object' &&
      value !== null &&
      'eventType' in value &&
      'sales' in value
    );
  }

  private recordFilterReason(
    buckets: Map<string, SkinportFilterBucket>,
    reason: string,
    marketHashName: string,
  ): void {
    const bucket = buckets.get(reason) ?? {
      count: 0,
      sampleNames: [],
    };

    bucket.count += 1;
    if (bucket.sampleNames.length < 5) {
      bucket.sampleNames.push(marketHashName);
    }
    buckets.set(reason, bucket);
  }

  private serializeFilterBuckets(
    buckets: ReadonlyMap<string, SkinportFilterBucket>,
  ): Record<string, SkinportFilterBucket> {
    return Object.fromEntries(buckets.entries());
  }

  private mergeFilterBuckets(
    target: Map<string, SkinportFilterBucket>,
    source: ReadonlyMap<string, SkinportFilterBucket>,
  ): void {
    for (const [reason, bucket] of source.entries()) {
      const existingBucket = target.get(reason) ?? {
        count: 0,
        sampleNames: [],
      };

      existingBucket.count += bucket.count;
      for (const sampleName of bucket.sampleNames) {
        if (existingBucket.sampleNames.length >= 5) {
          break;
        }

        if (!existingBucket.sampleNames.includes(sampleName)) {
          existingBucket.sampleNames.push(sampleName);
        }
      }
      target.set(reason, existingBucket);
    }
  }
}
