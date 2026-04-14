import { Prisma } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { AppLoggerService } from '../../../infrastructure/logging/app-logger.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { NormalizedMarketFactStorageResultDto } from '../dto/normalized-market-fact-storage-result.dto';
import type { NormalizedSourcePayloadDto } from '../dto/normalized-source-payload.dto';
import { SourceRecordService } from './source-record.service';

@Injectable()
export class SourceMarketFactStorageService {
  constructor(
    @Inject(AppLoggerService)
    private readonly logger: AppLoggerService,
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(SourceRecordService)
    private readonly sourceRecordService: SourceRecordService,
  ) {}

  async storeNormalizedMarketFacts(
    input: NormalizedSourcePayloadDto,
  ): Promise<NormalizedMarketFactStorageResultDto> {
    const source = await this.sourceRecordService.resolveByKey(input.source);
    const sourceMarketFactIds: string[] = [];
    const storedFacts: Array<
      NormalizedMarketFactStorageResultDto['storedFacts'][number]
    > = [];
    let skippedCount = 0;

    for (const marketState of input.marketStates) {
      if (!marketState.canonicalItemId || !marketState.itemVariantId) {
        skippedCount += 1;
        continue;
      }

      const storedFact = await this.prismaService.sourceMarketFact.upsert({
        where: {
          sourceId_rawPayloadArchiveId_itemVariantId: {
            sourceId: source.id,
            rawPayloadArchiveId: input.rawPayloadArchiveId,
            itemVariantId: marketState.itemVariantId,
          },
        },
        create: {
          sourceId: source.id,
          rawPayloadArchiveId: input.rawPayloadArchiveId,
          ...(input.fetchJobId ? { fetchJobId: input.fetchJobId } : {}),
          canonicalItemId: marketState.canonicalItemId,
          itemVariantId: marketState.itemVariantId,
          endpointName: input.endpointName,
          currencyCode: this.normalizeCurrencyCode(marketState.currency),
          ...(marketState.lowestAskMinor !== undefined
            ? { lowestAskGross: this.minorToDecimal(marketState.lowestAskMinor) }
            : {}),
          ...(marketState.highestBidMinor !== undefined
            ? { highestBidGross: this.minorToDecimal(marketState.highestBidMinor) }
            : {}),
          ...(marketState.medianAskMinor !== undefined
            ? { medianAskGross: this.minorToDecimal(marketState.medianAskMinor) }
            : {}),
          ...(marketState.lastTradeMinor !== undefined
            ? { lastTradeGross: this.minorToDecimal(marketState.lastTradeMinor) }
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
          ...(marketState.metadata
            ? {
                metadata: JSON.parse(
                  JSON.stringify(marketState.metadata),
                ) as Prisma.InputJsonValue,
              }
            : {}),
        },
        update: {
          endpointName: input.endpointName,
          currencyCode: this.normalizeCurrencyCode(marketState.currency),
          ...(input.fetchJobId ? { fetchJobId: input.fetchJobId } : {}),
          ...(marketState.lowestAskMinor !== undefined
            ? { lowestAskGross: this.minorToDecimal(marketState.lowestAskMinor) }
            : {}),
          ...(marketState.highestBidMinor !== undefined
            ? { highestBidGross: this.minorToDecimal(marketState.highestBidMinor) }
            : {}),
          ...(marketState.medianAskMinor !== undefined
            ? { medianAskGross: this.minorToDecimal(marketState.medianAskMinor) }
            : {}),
          ...(marketState.lastTradeMinor !== undefined
            ? { lastTradeGross: this.minorToDecimal(marketState.lastTradeMinor) }
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
          ...(marketState.metadata
            ? {
                metadata: JSON.parse(
                  JSON.stringify(marketState.metadata),
                ) as Prisma.InputJsonValue,
              }
            : {}),
        },
        select: {
          id: true,
          itemVariantId: true,
          canonicalItemId: true,
          observedAt: true,
        },
      });

      sourceMarketFactIds.push(storedFact.id);
      storedFacts.push(storedFact);
    }

    this.logger.log(
      `Persisted ${sourceMarketFactIds.length} source market facts for ${input.source}:${input.endpointName} (${input.rawPayloadArchiveId}); skipped ${skippedCount}.`,
      SourceMarketFactStorageService.name,
    );

    return {
      source: input.source,
      rawPayloadArchiveId: input.rawPayloadArchiveId,
      storedCount: sourceMarketFactIds.length,
      skippedCount,
      sourceMarketFactIds,
      storedFacts,
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

  private minorToDecimal(value: number): Prisma.Decimal {
    const absoluteMinor = Math.abs(value);
    const units = Math.trunc(absoluteMinor / 100);
    const cents = absoluteMinor % 100;
    const prefix = value < 0 ? '-' : '';

    return new Prisma.Decimal(
      `${prefix}${units}.${cents.toString().padStart(2, '0')}`,
    );
  }
}
