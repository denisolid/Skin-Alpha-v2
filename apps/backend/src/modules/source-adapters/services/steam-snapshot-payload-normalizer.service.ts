import { Inject, Injectable } from '@nestjs/common';

import type { ArchivedRawPayloadDto } from '../dto/archived-raw-payload.dto';
import type { NormalizedMarketStateDto } from '../dto/normalized-market-state.dto';
import type { NormalizedSourcePayloadDto } from '../dto/normalized-source-payload.dto';
import type {
  SteamSnapshotBatchPayloadDto,
  SteamSnapshotFetchedItemDto,
} from '../dto/steam-snapshot.dto';
import { SteamSnapshotFallbackService } from './steam-snapshot-fallback.service';

@Injectable()
export class SteamSnapshotPayloadNormalizerService {
  constructor(
    @Inject(SteamSnapshotFallbackService)
    private readonly steamSnapshotFallbackService: SteamSnapshotFallbackService,
  ) {}

  normalize(archive: ArchivedRawPayloadDto): NormalizedSourcePayloadDto {
    if (archive.endpointName !== 'steam-snapshot-priceoverview-batch') {
      return {
        rawPayloadArchiveId: archive.id,
        source: archive.source,
        endpointName: archive.endpointName,
        observedAt: archive.observedAt,
        payloadHash: archive.payloadHash,
        listings: [],
        marketStates: [],
        warnings: [`Unsupported Steam endpoint ${archive.endpointName}.`],
      };
    }

    const payload = this.isSteamSnapshotBatchPayload(archive.payload)
      ? archive.payload
      : null;

    if (!payload) {
      return {
        rawPayloadArchiveId: archive.id,
        source: archive.source,
        endpointName: archive.endpointName,
        observedAt: archive.observedAt,
        payloadHash: archive.payloadHash,
        listings: [],
        marketStates: [],
        warnings: ['Invalid Steam snapshot batch payload.'],
      };
    }

    const marketStates: NormalizedMarketStateDto[] = [];
    const warnings: string[] = [];

    for (const item of payload.items) {
      const marketState = this.normalizeFetchedItem(item, archive.observedAt);

      if (marketState) {
        marketStates.push(marketState);
        continue;
      }

      warnings.push(
        `Steam snapshot did not yield market state for ${item.target.marketHashName}.`,
      );
    }

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

  private normalizeFetchedItem(
    item: SteamSnapshotFetchedItemDto,
    observedAt: Date,
  ): NormalizedMarketStateDto | null {
    if (!item.priceOverview?.success) {
      return null;
    }

    const lowestAskMinor = item.priceOverview.lowest_price
      ? this.parseSteamPriceToMinor(item.priceOverview.lowest_price)
      : undefined;
    const medianAskMinor = item.priceOverview.median_price
      ? this.parseSteamPriceToMinor(item.priceOverview.median_price)
      : undefined;
    const listingCount = item.priceOverview.volume
      ? this.parseSteamVolume(item.priceOverview.volume)
      : undefined;

    if (lowestAskMinor === undefined && medianAskMinor === undefined) {
      return null;
    }

    const freshnessMetadata =
      this.steamSnapshotFallbackService.buildSnapshotMetadata(observedAt);
    const baseConfidence =
      lowestAskMinor !== undefined && medianAskMinor !== undefined ? 0.75 : 0.6;
    const liquidityScore =
      listingCount !== undefined
        ? this.deriveLiquidityScore(listingCount)
        : undefined;
    const confidence = Math.max(
      0,
      baseConfidence - freshnessMetadata.confidencePenalty,
    );

    return {
      source: 'steam-snapshot',
      canonicalItemId: item.target.canonicalItemId,
      itemVariantId: item.target.itemVariantId,
      capturedAt: observedAt,
      currency: 'USD',
      ...(listingCount !== undefined ? { listingCount } : {}),
      ...(lowestAskMinor !== undefined ? { lowestAskMinor } : {}),
      ...(medianAskMinor !== undefined ? { medianAskMinor } : {}),
      ...(liquidityScore !== undefined ? { liquidityScore } : {}),
      confidence,
      metadata: {
        marketHashName: item.target.marketHashName,
        priorityScore: item.target.priorityScore,
        priorityReason: item.target.priorityReason,
        rawLowestPrice: item.priceOverview.lowest_price ?? null,
        rawMedianPrice: item.priceOverview.median_price ?? null,
        rawVolume: item.priceOverview.volume ?? null,
        ...(item.target.steamObservedAt
          ? { previousSteamObservedAt: item.target.steamObservedAt }
          : {}),
        ...freshnessMetadata,
      },
    };
  }

  private deriveLiquidityScore(quantity: number): number {
    return Math.min(1, Math.log10(quantity + 1) / 2);
  }

  private parseSteamVolume(value: string): number | undefined {
    const parsedValue = Number(value.replace(/[^\d]/g, ''));

    return Number.isNaN(parsedValue) ? undefined : parsedValue;
  }

  private parseSteamPriceToMinor(value: string): number | undefined {
    const trimmedValue = value.trim();
    const numericPortion = trimmedValue.replace(/[^\d.,-]/g, '');

    if (!numericPortion) {
      return undefined;
    }

    const lastCommaIndex = numericPortion.lastIndexOf(',');
    const lastDotIndex = numericPortion.lastIndexOf('.');
    const decimalIndex = Math.max(lastCommaIndex, lastDotIndex);

    if (decimalIndex >= 0) {
      const integerPart = numericPortion
        .slice(0, decimalIndex)
        .replace(/[^\d-]/g, '');
      const decimalPart = numericPortion
        .slice(decimalIndex + 1)
        .replace(/[^\d]/g, '')
        .slice(0, 2)
        .padEnd(2, '0');
      const normalizedNumber = `${integerPart || '0'}.${decimalPart}`;
      const parsedValue = Number(normalizedNumber);

      return Number.isNaN(parsedValue)
        ? undefined
        : Math.round(parsedValue * 100);
    }

    const parsedValue = Number(numericPortion.replace(/[^\d-]/g, ''));

    return Number.isNaN(parsedValue) ? undefined : parsedValue;
  }

  private isSteamSnapshotBatchPayload(
    value: unknown,
  ): value is SteamSnapshotBatchPayloadDto {
    return (
      typeof value === 'object' &&
      value !== null &&
      'batchId' in value &&
      'items' in value &&
      Array.isArray((value as { items?: unknown[] }).items)
    );
  }
}
