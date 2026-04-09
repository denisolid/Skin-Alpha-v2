import { Prisma } from '@prisma/client';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  MARKET_STATE_CHANGE_EMITTER,
  type MarketStateChangedEvent,
  type MarketStateChangeEmitter,
} from '../domain/market-state-change.port';
import type { UpdateLatestMarketStateBatchInput } from '../domain/market-state-write.model';
import {
  MARKET_STATE_WRITE_REPOSITORY,
  type MarketStateWriteRepository,
} from '../domain/market-state-write.repository';
import type { MarketStateUpdateResultDto } from '../dto/market-state-update-result.dto';

@Injectable()
export class MarketStateUpdaterService {
  constructor(
    @Inject(MARKET_STATE_WRITE_REPOSITORY)
    private readonly marketStateWriteRepository: MarketStateWriteRepository,
    @Inject(MARKET_STATE_CHANGE_EMITTER)
    private readonly marketStateChangeEmitter: MarketStateChangeEmitter,
  ) {}

  async updateLatestState(
    input: UpdateLatestMarketStateBatchInput,
  ): Promise<MarketStateUpdateResultDto> {
    return this.updateLatestStateBatch(input);
  }

  async updateLatestStateBatch(
    input: UpdateLatestMarketStateBatchInput,
  ): Promise<MarketStateUpdateResultDto> {
    const source = await this.marketStateWriteRepository.findSourceByCode(
      input.source,
    );

    if (!source) {
      throw new NotFoundException(
        `Source '${input.source}' was not found for market-state projection.`,
      );
    }

    let snapshotCount = 0;
    let upsertedStateCount = 0;
    let skippedCount = 0;
    const changedEvents: MarketStateChangedEvent[] = [];

    for (const marketState of input.marketStates) {
      if (!marketState.canonicalItemId || !marketState.itemVariantId) {
        skippedCount += 1;
        continue;
      }

      const projection =
        await this.marketStateWriteRepository.appendSnapshotAndProjectLatestState(
          {
            sourceId: source.id,
            sourceCode: source.code,
            canonicalItemId: marketState.canonicalItemId,
            itemVariantId: marketState.itemVariantId,
            ...(input.rawPayloadArchiveId
              ? { rawPayloadArchiveId: input.rawPayloadArchiveId }
              : {}),
            currencyCode: this.normalizeCurrencyCode(marketState.currency),
            ...(marketState.lowestAskMinor !== undefined
              ? {
                  lowestAskGross: this.minorToDecimal(
                    marketState.lowestAskMinor,
                  ),
                }
              : {}),
            ...(marketState.highestBidMinor !== undefined
              ? {
                  highestBidGross: this.minorToDecimal(
                    marketState.highestBidMinor,
                  ),
                }
              : {}),
            ...(marketState.lastTradeMinor !== undefined
              ? {
                  lastTradeGross: this.minorToDecimal(
                    marketState.lastTradeMinor,
                  ),
                }
              : {}),
            ...(marketState.average24hMinor !== undefined
              ? {
                  average24hGross: this.minorToDecimal(
                    marketState.average24hMinor,
                  ),
                }
              : {}),
            ...(marketState.listingCount !== undefined
              ? { listingCount: marketState.listingCount }
              : {}),
            ...(marketState.saleCount24h !== undefined
              ? { saleCount24h: marketState.saleCount24h }
              : {}),
            ...(marketState.sampleSize !== undefined
              ? { sampleSize: marketState.sampleSize }
              : {}),
            ...(marketState.confidence !== undefined
              ? { confidence: this.decimalFromNumber(marketState.confidence) }
              : {}),
            ...(marketState.liquidityScore !== undefined
              ? {
                  liquidityScore: this.decimalFromNumber(
                    marketState.liquidityScore,
                  ),
                }
              : {}),
            observedAt: marketState.capturedAt,
          },
        );

      snapshotCount += 1;
      upsertedStateCount += 1;
      changedEvents.push({
        source: projection.sourceCode,
        marketStateId: projection.marketStateId,
        latestSnapshotId: projection.latestSnapshotId,
        canonicalItemId: projection.canonicalItemId,
        itemVariantId: projection.itemVariantId,
        observedAt: projection.observedAt,
        ...(projection.rawPayloadArchiveId
          ? { rawPayloadArchiveId: projection.rawPayloadArchiveId }
          : {}),
      });
    }

    await this.marketStateChangeEmitter.emitChanged(changedEvents);

    return {
      source: input.source,
      ...(input.rawPayloadArchiveId
        ? { rawPayloadArchiveId: input.rawPayloadArchiveId }
        : {}),
      snapshotCount,
      upsertedStateCount,
      skippedCount,
    };
  }

  private normalizeCurrencyCode(currency: string): string {
    return currency.trim().toUpperCase().slice(0, 3) || 'USD';
  }

  private decimalFromNumber(value: number | undefined): Prisma.Decimal | null {
    if (value === undefined || !Number.isFinite(value)) {
      return null;
    }

    return new Prisma.Decimal(value.toFixed(4));
  }

  private minorToDecimal(value: number | undefined): Prisma.Decimal | null {
    if (value === undefined) {
      return null;
    }

    const absoluteMinor = Math.abs(value);
    const units = Math.trunc(absoluteMinor / 100);
    const cents = absoluteMinor % 100;
    const prefix = value < 0 ? '-' : '';

    return new Prisma.Decimal(
      `${prefix}${units}.${cents.toString().padStart(2, '0')}`,
    );
  }
}
