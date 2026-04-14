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
import { mapWithConcurrencyLimit } from '../../shared/utils/async.util';
import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';

const MARKET_STATE_UPDATE_CONCURRENCY_LIMIT = 4;

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

  async refreshLatestStateHeartbeat(input: {
    readonly source: UpdateLatestMarketStateBatchInput['source'];
    readonly equivalentRawPayloadArchiveId: string;
    readonly observedAt: Date;
    readonly rawPayloadArchiveId?: string;
  }): Promise<number> {
    const source = await this.marketStateWriteRepository.findSourceByCode(
      input.source,
    );

    if (!source) {
      throw new NotFoundException(
        `Source '${input.source}' was not found for market-state freshness refresh.`,
      );
    }

    const refreshedStates =
      await this.marketStateWriteRepository.refreshLatestStateHeartbeat({
        sourceId: source.id,
        sourceCode: source.code,
        equivalentRawPayloadArchiveId: input.equivalentRawPayloadArchiveId,
        observedAt: input.observedAt,
      });

    if (refreshedStates.length === 0) {
      return 0;
    }

    const changedEvents = refreshedStates
      .filter(
        (
          state,
        ): state is typeof state & {
          readonly latestSnapshotId: string;
        } => state.latestSnapshotId !== null,
      )
      .map((state) => ({
        source: state.sourceCode,
        marketStateId: state.marketStateId,
        latestSnapshotId: state.latestSnapshotId,
        canonicalItemId: state.canonicalItemId,
        itemVariantId: state.itemVariantId,
        observedAt: state.observedAt,
        ...(input.rawPayloadArchiveId
          ? { rawPayloadArchiveId: input.rawPayloadArchiveId }
          : {}),
      }));

    if (changedEvents.length > 0) {
      await this.marketStateChangeEmitter.emitChanged(changedEvents);
    }

    return refreshedStates.length;
  }

  async refreshLatestStateHeartbeatForVariants(input: {
    readonly source: SourceAdapterKey;
    readonly itemVariantIds: readonly string[];
    readonly observedAt: Date;
    readonly rawPayloadArchiveId?: string;
  }): Promise<number> {
    const uniqueItemVariantIds = [...new Set(input.itemVariantIds)];

    if (uniqueItemVariantIds.length === 0) {
      return 0;
    }

    const source = await this.marketStateWriteRepository.findSourceByCode(
      input.source,
    );

    if (!source) {
      throw new NotFoundException(
        `Source '${input.source}' was not found for market-state freshness refresh.`,
      );
    }

    const refreshedStates =
      await this.marketStateWriteRepository.refreshLatestStateHeartbeatForVariants(
        {
          sourceId: source.id,
          sourceCode: source.code,
          itemVariantIds: uniqueItemVariantIds,
          observedAt: input.observedAt,
        },
      );

    if (refreshedStates.length === 0) {
      return 0;
    }

    const changedEvents = refreshedStates
      .filter(
        (
          state,
        ): state is typeof state & {
          readonly latestSnapshotId: string;
        } => state.latestSnapshotId !== null,
      )
      .map((state) => ({
        source: state.sourceCode,
        marketStateId: state.marketStateId,
        latestSnapshotId: state.latestSnapshotId,
        canonicalItemId: state.canonicalItemId,
        itemVariantId: state.itemVariantId,
        observedAt: state.observedAt,
        ...(input.rawPayloadArchiveId
          ? { rawPayloadArchiveId: input.rawPayloadArchiveId }
          : {}),
      }));

    if (changedEvents.length > 0) {
      await this.marketStateChangeEmitter.emitChanged(changedEvents);
    }

    return refreshedStates.length;
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
    let unchangedProjectionSkipCount = 0;
    const changedEvents: MarketStateChangedEvent[] = [];

    const projections = await mapWithConcurrencyLimit(
      input.marketStates,
      MARKET_STATE_UPDATE_CONCURRENCY_LIMIT,
      async (marketState) => {
        if (!marketState.canonicalItemId || !marketState.itemVariantId) {
          return null;
        }

        const capturedAt = this.requireCapturedAt(
          marketState.capturedAt,
          input.source,
          marketState.itemVariantId,
        );

        return this.marketStateWriteRepository.appendSnapshotAndProjectLatestState(
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
            observedAt: capturedAt,
          },
        );
      },
    );

    for (const projection of projections) {
      if (!projection) {
        skippedCount += 1;
        continue;
      }

      if (projection.snapshotCreated) {
        snapshotCount += 1;
      }
      upsertedStateCount += 1;
      if (projection.unchangedProjectionSkipped) {
        unchangedProjectionSkipCount += 1;
      }
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
      unchangedProjectionSkipCount,
    };
  }

  private requireCapturedAt(
    capturedAt: unknown,
    source: UpdateLatestMarketStateBatchInput['source'],
    itemVariantId: string,
  ): Date {
    if (capturedAt instanceof Date && !Number.isNaN(capturedAt.getTime())) {
      return capturedAt;
    }

    throw new TypeError(
      `Invalid capturedAt for ${source} market state projection (${itemVariantId}). Expected a valid Date instance before repository write.`,
    );
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
