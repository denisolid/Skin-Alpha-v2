import { Inject, Injectable } from '@nestjs/common';

import { AppLoggerService } from '../../../infrastructure/logging/app-logger.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  chunkArray,
  mapWithConcurrencyLimit,
} from '../../shared/utils/async.util';
import type { NormalizedMarketStateDto } from '../dto/normalized-market-state.dto';
import type { NormalizedSourcePayloadDto } from '../dto/normalized-source-payload.dto';
import { SourceRecordService } from './source-record.service';

interface StoredMarketFactFingerprintRecord {
  readonly itemVariantId: string;
  readonly canonicalItemId: string;
  readonly currencyCode: string;
  readonly lowestAskGross: { toString(): string } | null;
  readonly highestBidGross: { toString(): string } | null;
  readonly medianAskGross: { toString(): string } | null;
  readonly lastTradeGross: { toString(): string } | null;
  readonly average24hGross: { toString(): string } | null;
  readonly listingCount: number | null;
  readonly saleCount24h: number | null;
  readonly sampleSize: number | null;
  readonly confidence: { toString(): string } | null;
  readonly liquidityScore: { toString(): string } | null;
}

export interface NormalizedMarketStateDeltaResult {
  readonly payload: NormalizedSourcePayloadDto;
  readonly unchangedMarketStates: readonly NormalizedMarketStateDto[];
  readonly changedMarketStateCount: number;
  readonly unchangedMarketStateCount: number;
}

const MARKET_FACT_LOOKUP_CHUNK_SIZE = 1_000;
const MARKET_FACT_LOOKUP_CONCURRENCY = 2;

@Injectable()
export class NormalizedMarketStateDeltaService {
  constructor(
    @Inject(AppLoggerService)
    private readonly logger: AppLoggerService,
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(SourceRecordService)
    private readonly sourceRecordService: SourceRecordService,
  ) {}

  async applyChangedOnlyGate(
    payload: NormalizedSourcePayloadDto,
  ): Promise<NormalizedMarketStateDeltaResult> {
    if (!this.isChangedOnlyEligible(payload)) {
      return {
        payload,
        unchangedMarketStates: [],
        changedMarketStateCount: payload.marketStates.length,
        unchangedMarketStateCount: 0,
      };
    }

    const source = await this.sourceRecordService.resolveByKey(payload.source);
    const marketStatesWithIds = payload.marketStates.filter(
      (
        marketState,
      ): marketState is NormalizedMarketStateDto & {
        readonly canonicalItemId: string;
        readonly itemVariantId: string;
      } =>
        typeof marketState.canonicalItemId === 'string' &&
        marketState.canonicalItemId.length > 0 &&
        typeof marketState.itemVariantId === 'string' &&
        marketState.itemVariantId.length > 0,
    );
    const uniqueVariantIds = [
      ...new Set(marketStatesWithIds.map((marketState) => marketState.itemVariantId)),
    ];

    if (uniqueVariantIds.length === 0) {
      return {
        payload,
        unchangedMarketStates: [],
        changedMarketStateCount: payload.marketStates.length,
        unchangedMarketStateCount: 0,
      };
    }

    const [latestFactsByVariantId, activeStateVariantIds] = await Promise.all([
      this.loadLatestStoredFactsByVariantId(
        source.id,
        payload.endpointName,
        uniqueVariantIds,
      ),
      this.loadActiveStateVariantIds(source.id, uniqueVariantIds),
    ]);

    const changedMarketStates: NormalizedMarketStateDto[] = [];
    const unchangedMarketStates: NormalizedMarketStateDto[] = [];

    for (const marketState of payload.marketStates) {
      if (!marketState.itemVariantId || !marketState.canonicalItemId) {
        changedMarketStates.push(marketState);
        continue;
      }

      const identifiedMarketState = marketState as NormalizedMarketStateDto & {
        readonly canonicalItemId: string;
        readonly itemVariantId: string;
      };

      const latestStoredFact = latestFactsByVariantId.get(
        identifiedMarketState.itemVariantId,
      );
      const hasProjectedState = activeStateVariantIds.has(
        identifiedMarketState.itemVariantId,
      );

      if (
        latestStoredFact &&
        hasProjectedState &&
        this.buildNormalizedMarketStateFingerprint(identifiedMarketState) ===
          this.buildStoredMarketFactFingerprint(latestStoredFact)
      ) {
        unchangedMarketStates.push(identifiedMarketState);
        continue;
      }

      changedMarketStates.push(identifiedMarketState);
    }

    if (unchangedMarketStates.length > 0) {
      this.logger.log(
        `Applied changed-only market-state gate for ${payload.source}:${payload.endpointName} (${payload.rawPayloadArchiveId}): total=${payload.marketStates.length} changed=${changedMarketStates.length} unchanged=${unchangedMarketStates.length}.`,
        NormalizedMarketStateDeltaService.name,
      );
    }

    return {
      payload: {
        ...payload,
        marketStates: changedMarketStates,
      },
      unchangedMarketStates,
      changedMarketStateCount: changedMarketStates.length,
      unchangedMarketStateCount: unchangedMarketStates.length,
    };
  }

  private async loadLatestStoredFactsByVariantId(
    sourceId: string,
    endpointName: string,
    itemVariantIds: readonly string[],
  ): Promise<ReadonlyMap<string, StoredMarketFactFingerprintRecord>> {
    const chunks = chunkArray(itemVariantIds, MARKET_FACT_LOOKUP_CHUNK_SIZE);
    const chunkResults = await mapWithConcurrencyLimit(
      chunks,
      MARKET_FACT_LOOKUP_CONCURRENCY,
      async (itemVariantIdChunk) =>
        this.prismaService.sourceMarketFact.findMany({
          where: {
            sourceId,
            endpointName,
            itemVariantId: {
              in: itemVariantIdChunk,
            },
          },
          distinct: ['itemVariantId'],
          orderBy: [
            {
              itemVariantId: 'asc',
            },
            {
              observedAt: 'desc',
            },
            {
              normalizedAt: 'desc',
            },
          ],
          select: {
            itemVariantId: true,
            canonicalItemId: true,
            currencyCode: true,
            lowestAskGross: true,
            highestBidGross: true,
            medianAskGross: true,
            lastTradeGross: true,
            average24hGross: true,
            listingCount: true,
            saleCount24h: true,
            sampleSize: true,
            confidence: true,
            liquidityScore: true,
          },
        }),
    );
    const factsByVariantId = new Map<string, StoredMarketFactFingerprintRecord>();

    for (const chunkResult of chunkResults) {
      for (const marketFact of chunkResult) {
        factsByVariantId.set(marketFact.itemVariantId, marketFact);
      }
    }

    return factsByVariantId;
  }

  private async loadActiveStateVariantIds(
    sourceId: string,
    itemVariantIds: readonly string[],
  ): Promise<ReadonlySet<string>> {
    const chunks = chunkArray(itemVariantIds, MARKET_FACT_LOOKUP_CHUNK_SIZE);
    const chunkResults = await mapWithConcurrencyLimit(
      chunks,
      MARKET_FACT_LOOKUP_CONCURRENCY,
      async (itemVariantIdChunk) =>
        this.prismaService.marketState.findMany({
          where: {
            sourceId,
            itemVariantId: {
              in: itemVariantIdChunk,
            },
          },
          select: {
            itemVariantId: true,
          },
        }),
    );
    const variantIds = new Set<string>();

    for (const chunkResult of chunkResults) {
      for (const marketState of chunkResult) {
        variantIds.add(marketState.itemVariantId);
      }
    }

    return variantIds;
  }

  private buildNormalizedMarketStateFingerprint(
    marketState: NormalizedMarketStateDto & {
      readonly canonicalItemId: string;
      readonly itemVariantId: string;
    },
  ): string {
    return [
      marketState.canonicalItemId,
      marketState.itemVariantId,
      this.normalizeCurrencyCode(marketState.currency),
      marketState.lowestAskMinor ?? 'null',
      marketState.highestBidMinor ?? 'null',
      marketState.medianAskMinor ?? 'null',
      marketState.lastTradeMinor ?? 'null',
      marketState.average24hMinor ?? 'null',
      marketState.listingCount ?? 'null',
      marketState.saleCount24h ?? 'null',
      marketState.sampleSize ?? 'null',
      this.normalizeNumber(marketState.confidence),
      this.normalizeNumber(marketState.liquidityScore),
    ].join('|');
  }

  private buildStoredMarketFactFingerprint(
    marketFact: StoredMarketFactFingerprintRecord,
  ): string {
    return [
      marketFact.canonicalItemId,
      marketFact.itemVariantId,
      this.normalizeCurrencyCode(marketFact.currencyCode),
      this.decimalToMinor(marketFact.lowestAskGross),
      this.decimalToMinor(marketFact.highestBidGross),
      this.decimalToMinor(marketFact.medianAskGross),
      this.decimalToMinor(marketFact.lastTradeGross),
      this.decimalToMinor(marketFact.average24hGross),
      marketFact.listingCount ?? 'null',
      marketFact.saleCount24h ?? 'null',
      marketFact.sampleSize ?? 'null',
      this.decimalToFixed(marketFact.confidence),
      this.decimalToFixed(marketFact.liquidityScore),
    ].join('|');
  }

  private isChangedOnlyEligible(payload: NormalizedSourcePayloadDto): boolean {
    return (
      ((payload.source === 'skinport' &&
        payload.endpointName === 'skinport-items-snapshot') ||
        (payload.source === 'bitskins' &&
          payload.endpointName === 'bitskins-listings')) &&
      payload.marketStates.length > 0
    );
  }

  private normalizeCurrencyCode(currency: string): string {
    return currency.trim().toUpperCase().slice(0, 3) || 'USD';
  }

  private normalizeNumber(value?: number): string {
    if (value === undefined || !Number.isFinite(value)) {
      return 'null';
    }

    return value.toFixed(4);
  }

  private decimalToMinor(
    value: { toString(): string } | null,
  ): string {
    if (value === null) {
      return 'null';
    }

    const numericValue = Number(value.toString());

    return Number.isFinite(numericValue)
      ? String(Math.round(numericValue * 100))
      : 'null';
  }

  private decimalToFixed(
    value: { toString(): string } | null,
  ): string {
    if (value === null) {
      return 'null';
    }

    const numericValue = Number(value.toString());

    return Number.isFinite(numericValue) ? numericValue.toFixed(4) : 'null';
  }
}
