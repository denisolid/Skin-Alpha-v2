import { Inject, Injectable } from '@nestjs/common';

import { AppLoggerService } from '../../../infrastructure/logging/app-logger.service';
import { CatalogService } from '../../catalog/services/catalog.service';
import type { CatalogResolutionDto } from '../../catalog/dto/catalog-resolution.dto';
import type { ArchivedRawPayloadDto } from '../dto/archived-raw-payload.dto';
import type { NormalizedMarketListingDto } from '../dto/normalized-market-listing.dto';
import type { NormalizedMarketStateDto } from '../dto/normalized-market-state.dto';
import type { NormalizedSourcePayloadDto } from '../dto/normalized-source-payload.dto';
import type {
  ManagedMarketSourceDefinition,
  ManagedMarketSourceKey,
} from '../domain/managed-market-source.types';
import { ManagedMarketSourceDefinitionsService } from './managed-market-source-definitions.service';

type JsonRecord = Record<string, unknown>;

interface FilterBucket {
  count: number;
  sampleTitles: string[];
}

@Injectable()
export class ManagedMarketPayloadNormalizerService {
  constructor(
    @Inject(AppLoggerService)
    private readonly logger: AppLoggerService,
    @Inject(CatalogService)
    private readonly catalogService: CatalogService,
    @Inject(ManagedMarketSourceDefinitionsService)
    private readonly definitionsService: ManagedMarketSourceDefinitionsService,
  ) {}

  async normalize(
    archive: ArchivedRawPayloadDto,
  ): Promise<NormalizedSourcePayloadDto> {
    const definition = this.definitionsService.get(
      archive.source as ManagedMarketSourceKey,
    );
    const records = this.extractListingRecords(archive.payload);
    const listings: NormalizedMarketListingDto[] = [];
    const warnings: string[] = [];
    const filterBuckets = new Map<string, FilterBucket>();

    for (const record of records) {
      const normalizedListing = await this.normalizeRecord(
        definition,
        archive,
        record,
        warnings,
        filterBuckets,
      );

      if (normalizedListing) {
        listings.push(normalizedListing);
      }
    }

    const marketStates = this.aggregateMarketStates(
      definition,
      archive,
      listings,
    );

    this.logger.log(
      `${definition.displayName} ${archive.endpointName} (${archive.id}) detected ${records.length} records, normalized ${listings.length} listings, and built ${marketStates.length} market states. Filters: ${JSON.stringify(this.serializeFilterBuckets(filterBuckets))}.`,
      ManagedMarketPayloadNormalizerService.name,
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

  private async normalizeRecord(
    definition: ManagedMarketSourceDefinition,
    archive: ArchivedRawPayloadDto,
    record: JsonRecord,
    warnings: string[],
    filterBuckets: Map<string, FilterBucket>,
  ): Promise<NormalizedMarketListingDto | null> {
    const itemRecord = this.readObject(record.item);
    const sellerRecord = this.readObject(record.seller);
    const scmRecord = this.readObject(record.scm);
    const title = this.readFirstString([
      record.market_hash_name,
      record.marketHashName,
      record.name,
      record.title,
      record.item_name,
      record.market_name,
      itemRecord.market_hash_name,
      itemRecord.marketHashName,
      itemRecord.name,
      itemRecord.title,
      itemRecord.item_name,
    ]);

    if (!title) {
      this.recordFilterReason(filterBuckets, 'missing_title', 'unknown');
      return null;
    }

    const priceMinor = this.resolvePriceMinor(record, itemRecord);

    if (priceMinor === undefined || priceMinor <= 0) {
      this.recordFilterReason(filterBuckets, 'missing_price', title);
      return null;
    }

    const quantityAvailable =
      this.readFirstNumber([
        record.quantity,
        record.count,
        record.stock,
        record.sell_num,
        itemRecord.quantity,
        itemRecord.count,
      ]) ?? 1;
    const condition = this.readFirstString([
      record.exterior,
      record.condition,
      record.wear_name,
      itemRecord.exterior,
      itemRecord.condition,
      itemRecord.wear_name,
    ]);
    const phaseHint = this.readFirstString([
      record.phase,
      record.doppler_phase,
      itemRecord.phase,
      itemRecord.doppler_phase,
    ]);
    const isStatTrak = this.resolveQualityFlag(
      title,
      [
        record.stattrak,
        record.isStatTrak,
        itemRecord.stattrak,
        itemRecord.isStatTrak,
      ],
      'stattrak',
    );
    const isSouvenir = this.resolveQualityFlag(
      title,
      [
        record.souvenir,
        record.isSouvenir,
        itemRecord.souvenir,
        itemRecord.isSouvenir,
      ],
      'souvenir',
    );
    const resolution = await this.catalogService.resolveSourceListing({
      source: definition.key,
      marketHashName: title,
      ...(this.readFirstString([
        record.type,
        itemRecord.type,
        record.weapon,
        itemRecord.weapon,
      ])
        ? {
            type: this.readFirstString([
              record.type,
              itemRecord.type,
              record.weapon,
              itemRecord.weapon,
            ])!,
          }
        : {}),
      ...(this.readFirstString([record.weapon, itemRecord.weapon])
        ? { weapon: this.readFirstString([record.weapon, itemRecord.weapon])! }
        : {}),
      ...(this.readFirstString([record.skin_name, itemRecord.skin_name])
        ? {
            skinName: this.readFirstString([
              record.skin_name,
              itemRecord.skin_name,
            ])!,
          }
        : {}),
      ...(condition ? { exterior: condition } : {}),
      ...(this.readFirstString([record.rarity, itemRecord.rarity])
        ? { rarity: this.readFirstString([record.rarity, itemRecord.rarity])! }
        : {}),
      isStatTrak,
      isSouvenir,
      ...(this.readFirstNumber([
        record.def_index,
        itemRecord.def_index,
        record.defIndex,
        itemRecord.defIndex,
      ]) !== undefined
        ? {
            defIndex: this.readFirstNumber([
              record.def_index,
              itemRecord.def_index,
              record.defIndex,
              itemRecord.defIndex,
            ])!,
          }
        : {}),
      ...(this.readFirstNumber([
        record.paint_index,
        itemRecord.paint_index,
        record.paintIndex,
        itemRecord.paintIndex,
      ]) !== undefined
        ? {
            paintIndex: this.readFirstNumber([
              record.paint_index,
              itemRecord.paint_index,
              record.paintIndex,
              itemRecord.paintIndex,
            ])!,
          }
        : {}),
      ...(phaseHint ? { phaseHint } : {}),
    });

    if (
      resolution.status !== 'resolved' ||
      !resolution.canonicalItemId ||
      !resolution.itemVariantId
    ) {
      this.recordFilterReason(
        filterBuckets,
        this.resolveMappingBucket(resolution),
        title,
      );
      warnings.push(this.buildResolutionWarning(definition, title, resolution));
      return null;
    }

    return {
      source: definition.key,
      externalListingId:
        this.readFirstString([
          record.id,
          record.listing_id,
          record.listingId,
          record.offer_id,
        ]) ?? `${definition.key}:${archive.observedAt.toISOString()}:${title}`,
      sourceItemId:
        this.readFirstString([
          record.asset_id,
          record.assetId,
          record.item_id,
          record.itemId,
          itemRecord.asset_id,
          itemRecord.assetId,
          itemRecord.id,
        ]) ?? title,
      canonicalItemId: resolution.canonicalItemId,
      itemVariantId: resolution.itemVariantId,
      title,
      observedAt: archive.observedAt,
      currency:
        this.readFirstString([record.currency, itemRecord.currency]) ??
        definition.currency,
      ...(this.readFirstString([
        record.url,
        record.listing_url,
        record.listingUrl,
        record.item_url,
        record.market_url,
      ])
        ? {
            listingUrl: this.readFirstString([
              record.url,
              record.listing_url,
              record.listingUrl,
              record.item_url,
              record.market_url,
            ])!,
          }
        : {}),
      priceMinor,
      quantityAvailable: Math.max(1, Math.trunc(quantityAvailable)),
      ...(condition ? { condition } : {}),
      ...(phaseHint ? { phase: phaseHint } : {}),
      ...(this.readFirstNumber([
        record.seed,
        record.paint_seed,
        itemRecord.seed,
        itemRecord.paint_seed,
      ]) !== undefined
        ? {
            paintSeed: this.readFirstNumber([
              record.seed,
              record.paint_seed,
              itemRecord.seed,
              itemRecord.paint_seed,
            ])!,
          }
        : {}),
      ...(this.readFirstNumber([
        record.float,
        record.float_value,
        record.wear,
        itemRecord.float,
        itemRecord.float_value,
        itemRecord.wear,
      ]) !== undefined
        ? {
            wearFloat: this.readFirstNumber([
              record.float,
              record.float_value,
              record.wear,
              itemRecord.float,
              itemRecord.float_value,
              itemRecord.wear,
            ])!,
          }
        : {}),
      isStatTrak,
      isSouvenir,
      metadata: {
        classification: definition.classification,
        behavior: definition.behavior,
        seller: Object.keys(sellerRecord).length > 0 ? sellerRecord : null,
        scm: Object.keys(scmRecord).length > 0 ? scmRecord : null,
        stickers: this.readArray(
          record.stickers ?? itemRecord.stickers ?? itemRecord.sticker_infos,
        ),
        rawName: this.readFirstString([record.name, itemRecord.name]) ?? null,
        matchConfidence: resolution.confidence,
      },
    };
  }

  private aggregateMarketStates(
    definition: ManagedMarketSourceDefinition,
    archive: ArchivedRawPayloadDto,
    listings: readonly NormalizedMarketListingDto[],
  ): readonly NormalizedMarketStateDto[] {
    const grouped = new Map<
      string,
      {
        canonicalItemId: string;
        itemVariantId: string;
        currency: string;
        listingCount: number;
        prices: number[];
        confidenceSum: number;
      }
    >();

    for (const listing of listings) {
      if (!listing.canonicalItemId || !listing.itemVariantId) {
        continue;
      }

      const groupKey = `${listing.canonicalItemId}:${listing.itemVariantId}:${listing.currency}`;
      const currentGroup = grouped.get(groupKey) ?? {
        canonicalItemId: listing.canonicalItemId,
        itemVariantId: listing.itemVariantId,
        currency: listing.currency,
        listingCount: 0,
        prices: [],
        confidenceSum: 0,
      };

      currentGroup.listingCount += Math.max(1, listing.quantityAvailable);
      currentGroup.prices.push(listing.priceMinor);
      currentGroup.confidenceSum +=
        typeof listing.metadata?.matchConfidence === 'number'
          ? listing.metadata.matchConfidence
          : 0.8;
      grouped.set(groupKey, currentGroup);
    }

    return [...grouped.values()].map((group) => {
      const lowestAskMinor = Math.min(...group.prices);
      const average24hMinor =
        group.prices.reduce((total, price) => total + price, 0) /
        Math.max(1, group.prices.length);
      const confidenceBase =
        group.confidenceSum / Math.max(1, group.prices.length);
      const densityBoost = Math.min(
        0.2,
        Math.log10(group.listingCount + 1) / 5,
      );
      const classificationPenalty =
        definition.classification === 'FRAGILE'
          ? 0.14
          : definition.classification === 'OPTIONAL'
            ? 0.08
            : definition.classification === 'REFERENCE'
              ? 0.2
              : 0;
      const confidence = Number(
        Math.max(
          0.15,
          Math.min(0.92, confidenceBase + densityBoost - classificationPenalty),
        ).toFixed(4),
      );
      const liquidityScore = Number(
        Math.min(1, Math.log10(group.listingCount + 1) / 2).toFixed(4),
      );

      return {
        source: definition.key,
        canonicalItemId: group.canonicalItemId,
        itemVariantId: group.itemVariantId,
        capturedAt: archive.observedAt,
        currency: group.currency,
        listingCount: group.listingCount,
        lowestAskMinor,
        average24hMinor: Math.round(average24hMinor),
        lastTradeMinor: Math.round(average24hMinor),
        sampleSize: group.prices.length,
        confidence,
        liquidityScore,
        metadata: {
          classification: definition.classification,
          behavior: definition.behavior,
          extractedListingCount: group.prices.length,
          sourceNotes: definition.notes,
        },
      };
    });
  }

  private extractListingRecords(payload: unknown): readonly JsonRecord[] {
    if (Array.isArray(payload)) {
      return payload
        .map((entry) => this.readObject(entry))
        .filter((entry) => Object.keys(entry).length > 0);
    }

    const root = this.readObject(payload);
    const directArrays = [
      root.items,
      root.listings,
      root.data,
      this.readObject(root.data).items,
      this.readObject(root.data).listings,
      this.readObject(root.result).items,
      this.readObject(root.result).listings,
      this.readObject(root.response).items,
      this.readObject(root.response).listings,
    ];

    for (const candidate of directArrays) {
      const arrayValue = this.readArray(candidate);

      if (arrayValue.length > 0) {
        return arrayValue
          .map((entry) => this.readObject(entry))
          .filter((entry) => Object.keys(entry).length > 0);
      }
    }

    return Object.keys(root).length > 0 ? [root] : [];
  }

  private buildResolutionWarning(
    definition: ManagedMarketSourceDefinition,
    title: string,
    resolution: Pick<
      CatalogResolutionDto,
      'confidence' | 'reason' | 'warnings'
    >,
  ): string {
    return `${definition.displayName} catalog resolver left "${title}" unresolved at confidence ${resolution.confidence.toFixed(2)}${resolution.reason ? ` (${resolution.reason})` : ''}${resolution.warnings.length > 0 ? `: ${resolution.warnings.join('; ')}` : '.'}`;
  }

  private resolveMappingBucket(
    resolution: Pick<CatalogResolutionDto, 'confidence' | 'reason'>,
  ): string {
    if (resolution.reason === 'catalog_low_confidence_match') {
      return 'low_confidence_mapping';
    }

    return 'unresolved_catalog';
  }

  private resolveQualityFlag(
    title: string,
    candidates: readonly unknown[],
    quality: 'stattrak' | 'souvenir',
  ): boolean {
    const explicitValue = candidates.find(
      (candidate) => typeof candidate === 'boolean',
    );

    if (typeof explicitValue === 'boolean') {
      return explicitValue;
    }

    if (quality === 'stattrak') {
      return /^StatTrak/iu.test(title);
    }

    return /^Souvenir/iu.test(title);
  }

  private resolvePriceMinor(
    record: JsonRecord,
    itemRecord: JsonRecord,
  ): number | undefined {
    const explicitMinor = this.readFirstNumber([
      record.price_minor,
      record.priceMinor,
      record.min_price_minor,
      itemRecord.price_minor,
      itemRecord.priceMinor,
    ]);

    if (explicitMinor !== undefined) {
      return Math.round(explicitMinor);
    }

    const price = this.readFirstNumber([
      record.price,
      record.min_price,
      record.current_price,
      record.sell_price,
      record.ask_price,
      record.amount,
      itemRecord.price,
      itemRecord.min_price,
      itemRecord.current_price,
      itemRecord.sell_price,
    ]);

    if (price === undefined) {
      return undefined;
    }

    return Number.isInteger(price) && price >= 10_000
      ? Math.round(price)
      : Math.round(price * 100);
  }

  private readObject(value: unknown): JsonRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as JsonRecord;
  }

  private readArray(value: unknown): readonly unknown[] {
    return Array.isArray(value) ? value : [];
  }

  private readFirstString(values: readonly unknown[]): string | undefined {
    for (const value of values) {
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }

    return undefined;
  }

  private readFirstNumber(values: readonly unknown[]): number | undefined {
    for (const value of values) {
      const parsedValue = this.readNumber(value);

      if (parsedValue !== undefined) {
        return parsedValue;
      }
    }

    return undefined;
  }

  private readNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      const parsedValue = Number(value.replace(/[^0-9.-]/g, ''));

      return Number.isFinite(parsedValue) ? parsedValue : undefined;
    }

    return undefined;
  }

  private recordFilterReason(
    buckets: Map<string, FilterBucket>,
    reason: string,
    sampleTitle: string,
  ): void {
    const bucket = buckets.get(reason) ?? {
      count: 0,
      sampleTitles: [],
    };

    bucket.count += 1;
    if (bucket.sampleTitles.length < 5) {
      bucket.sampleTitles.push(sampleTitle);
    }
    buckets.set(reason, bucket);
  }

  private serializeFilterBuckets(
    buckets: ReadonlyMap<string, FilterBucket>,
  ): Record<string, FilterBucket> {
    return Object.fromEntries(buckets.entries());
  }
}
