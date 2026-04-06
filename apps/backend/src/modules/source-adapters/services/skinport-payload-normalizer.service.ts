import { Inject, Injectable } from '@nestjs/common';

import { AppLoggerService } from '../../../infrastructure/logging/app-logger.service';
import type { ArchivedRawPayloadDto } from '../dto/archived-raw-payload.dto';
import type { NormalizedMarketListingDto } from '../dto/normalized-market-listing.dto';
import type { NormalizedMarketStateDto } from '../dto/normalized-market-state.dto';
import type { NormalizedSourcePayloadDto } from '../dto/normalized-source-payload.dto';
import type { SkinportItemSnapshotDto } from '../dto/skinport-item-snapshot.dto';
import type { SkinportSaleFeedEventDto } from '../dto/skinport-sale-feed-event.dto';
import type { SkinportSalesHistoryDto } from '../dto/skinport-sales-history.dto';
import { SkinportCatalogLinkerService } from './skinport-catalog-linker.service';

interface SkinportFilterBucket {
  count: number;
  sampleNames: string[];
}

@Injectable()
export class SkinportPayloadNormalizerService {
  constructor(
    @Inject(AppLoggerService)
    private readonly logger: AppLoggerService,
    @Inject(SkinportCatalogLinkerService)
    private readonly skinportCatalogLinkerService: SkinportCatalogLinkerService,
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
    const listings: NormalizedMarketListingDto[] = [];
    const marketStates: NormalizedMarketStateDto[] = [];
    const warnings: string[] = [];
    const filterBuckets = new Map<string, SkinportFilterBucket>();

    for (const item of payload) {
      const linkedItem =
        await this.skinportCatalogLinkerService.resolveOrCreate(
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
          source: archive.source,
          externalListingId: `skinport:items:${item.market_hash_name}`,
          sourceItemId: item.market_hash_name,
          canonicalItemId: linkedItem.canonicalItemId,
          itemVariantId: linkedItem.itemVariantId,
          title: item.market_hash_name,
          observedAt: archive.observedAt,
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
        source: archive.source,
        canonicalItemId: linkedItem.canonicalItemId,
        itemVariantId: linkedItem.itemVariantId,
        capturedAt: archive.observedAt,
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

    this.logger.log(
      `Skinport ${archive.endpointName} (${archive.id}) extracted ${listings.length} listings, filtered ${payload.length - listings.length} listing candidates, and produced ${marketStates.length} market states. Filter reasons: ${JSON.stringify(this.serializeFilterBuckets(filterBuckets))}.`,
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

    for (const item of payload) {
      const linkedItem =
        await this.skinportCatalogLinkerService.resolveOrCreate(
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
      `Skinport ${archive.endpointName} (${archive.id}) produced ${marketStates.length} market states from ${payload.length} records. Filter reasons: ${JSON.stringify(this.serializeFilterBuckets(filterBuckets))}.`,
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

    for (const sale of payload.sales) {
      const linkedItem =
        await this.skinportCatalogLinkerService.resolveOrCreate(
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
        title: sale.marketHashName,
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
      `Skinport ${archive.endpointName} (${archive.id}) extracted ${listings.length} websocket listings from ${payload.sales.length} sale-feed events. Filter reasons: ${JSON.stringify(this.serializeFilterBuckets(filterBuckets))}.`,
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
}
