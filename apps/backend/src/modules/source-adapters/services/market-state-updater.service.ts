import { Prisma } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { MarketStateUpdateResultDto } from '../dto/market-state-update-result.dto';
import type { NormalizedMarketStateDto } from '../dto/normalized-market-state.dto';
import type { UpdateMarketStateJobData } from '../dto/update-market-state.job.dto';
import { SourceRecordService } from './source-record.service';

interface UpdateMarketStateBatchInput {
  readonly source: UpdateMarketStateJobData['source'];
  readonly marketStates: readonly NormalizedMarketStateDto[];
  readonly rawPayloadArchiveId?: string;
}

@Injectable()
export class MarketStateUpdaterService {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(SourceRecordService)
    private readonly sourceRecordService: SourceRecordService,
  ) {}

  async updateLatestState(
    input: UpdateMarketStateJobData,
  ): Promise<MarketStateUpdateResultDto> {
    return this.updateLatestStateBatch(input);
  }

  async updateLatestStateBatch(
    input: UpdateMarketStateBatchInput,
  ): Promise<MarketStateUpdateResultDto> {
    const source = await this.sourceRecordService.resolveByKey(input.source);
    let snapshotCount = 0;
    let upsertedStateCount = 0;
    let skippedCount = 0;

    for (const marketState of input.marketStates) {
      if (!marketState.canonicalItemId || !marketState.itemVariantId) {
        skippedCount += 1;
        continue;
      }

      const canonicalItemId = marketState.canonicalItemId;
      const itemVariantId = marketState.itemVariantId;

      await this.prismaService.$transaction(async (transaction) => {
        const snapshot = await transaction.marketSnapshot.create({
          data: {
            sourceId: source.id,
            canonicalItemId,
            itemVariantId,
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
            observedAt: marketState.capturedAt,
          },
        });

        snapshotCount += 1;

        await transaction.marketState.upsert({
          where: {
            sourceId_itemVariantId: {
              sourceId: source.id,
              itemVariantId,
            },
          },
          create: {
            sourceId: source.id,
            canonicalItemId,
            itemVariantId,
            latestSnapshotId: snapshot.id,
            currencyCode: this.normalizeCurrencyCode(marketState.currency),
            observedAt: marketState.capturedAt,
            lastSyncedAt: new Date(),
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
          },
          update: {
            canonicalItemId,
            latestSnapshotId: snapshot.id,
            currencyCode: this.normalizeCurrencyCode(marketState.currency),
            observedAt: marketState.capturedAt,
            lastSyncedAt: new Date(),
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
          },
        });

        upsertedStateCount += 1;
      });
    }

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
