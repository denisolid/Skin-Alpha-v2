import { PendingMappingKind, type Prisma } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { AppLoggerService } from '../../../infrastructure/logging/app-logger.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CatalogAliasNormalizationService } from '../../catalog/services/catalog-alias-normalization.service';
import type { NormalizedSourcePayloadDto } from '../dto/normalized-source-payload.dto';
import { SourceRecordService } from './source-record.service';

@Injectable()
export class PendingSourceMappingService {
  constructor(
    @Inject(AppLoggerService)
    private readonly logger: AppLoggerService,
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(CatalogAliasNormalizationService)
    private readonly aliasNormalizationService: CatalogAliasNormalizationService,
    @Inject(SourceRecordService)
    private readonly sourceRecordService: SourceRecordService,
  ) {}

  async captureFromPayload(input: NormalizedSourcePayloadDto): Promise<number> {
    const source = await this.sourceRecordService.resolveByKey(input.source);
    let capturedCount = 0;

    for (const signal of input.mappingSignals ?? []) {
      await this.prismaService.pendingSourceMapping.create({
        data: {
          sourceId: source.id,
          rawPayloadArchiveId: input.rawPayloadArchiveId,
          ...(input.fetchJobId ? { fetchJobId: input.fetchJobId } : {}),
          endpointName: input.endpointName,
          kind:
            signal.kind === 'market_fact'
              ? PendingMappingKind.MARKET_FACT
              : PendingMappingKind.LISTING,
          sourceItemId: signal.sourceItemId,
          ...(signal.title ? { title: signal.title } : {}),
          ...(signal.title
            ? { normalizedTitle: this.normalizeTitle(signal.title) }
            : {}),
          observedAt: signal.observedAt,
          ...(signal.variantHints
            ? {
                variantHints: JSON.parse(
                  JSON.stringify(signal.variantHints),
                ) as Prisma.InputJsonValue,
              }
            : {}),
          ...(signal.metadata
            ? {
                metadata: JSON.parse(
                  JSON.stringify(signal.metadata),
                ) as Prisma.InputJsonValue,
              }
            : {}),
          resolutionNote: signal.resolutionNote,
        },
      });
      capturedCount += 1;
    }

    for (const listing of input.listings) {
      if (listing.canonicalItemId && listing.itemVariantId) {
        continue;
      }

      await this.prismaService.pendingSourceMapping.create({
        data: {
          sourceId: source.id,
          rawPayloadArchiveId: input.rawPayloadArchiveId,
          ...(input.fetchJobId ? { fetchJobId: input.fetchJobId } : {}),
          endpointName: input.endpointName,
          kind: PendingMappingKind.LISTING,
          sourceItemId: listing.sourceItemId,
          title: listing.title,
          normalizedTitle: this.normalizeTitle(listing.title),
          observedAt: listing.observedAt,
          variantHints: this.buildListingHints(listing),
        },
      });
      capturedCount += 1;
    }

    for (const marketState of input.marketStates) {
      if (marketState.canonicalItemId && marketState.itemVariantId) {
        continue;
      }

      await this.prismaService.pendingSourceMapping.create({
        data: {
          sourceId: source.id,
          rawPayloadArchiveId: input.rawPayloadArchiveId,
          ...(input.fetchJobId ? { fetchJobId: input.fetchJobId } : {}),
          endpointName: input.endpointName,
          kind: PendingMappingKind.MARKET_FACT,
          sourceItemId: `${input.endpointName}:${marketState.currency}:${marketState.capturedAt.toISOString()}`,
          observedAt: marketState.capturedAt,
          variantHints: this.buildMarketStateHints(marketState),
        },
      });
      capturedCount += 1;
    }

    if (capturedCount > 0) {
      this.logger.warn(
        `Captured ${capturedCount} unmapped source entities for ${input.source}:${input.endpointName} (${input.rawPayloadArchiveId}).`,
        PendingSourceMappingService.name,
      );
    }

    return capturedCount;
  }

  private buildListingHints(
    listing: NormalizedSourcePayloadDto['listings'][number],
  ): Prisma.InputJsonValue {
    return {
      currency: listing.currency,
      condition: listing.condition ?? null,
      phase: listing.phase ?? null,
      paintSeed: listing.paintSeed ?? null,
      wearFloat: listing.wearFloat ?? null,
      isStatTrak: listing.isStatTrak,
      isSouvenir: listing.isSouvenir,
      externalListingId: listing.externalListingId,
      ...(listing.metadata
        ? {
            metadata: JSON.parse(
              JSON.stringify(listing.metadata),
            ) as Prisma.InputJsonValue,
          }
        : {}),
    } satisfies Prisma.InputJsonObject;
  }

  private buildMarketStateHints(
    marketState: NormalizedSourcePayloadDto['marketStates'][number],
  ): Prisma.InputJsonValue {
    return {
      currency: marketState.currency,
      listingCount: marketState.listingCount ?? null,
      sampleSize: marketState.sampleSize ?? null,
      lowestAskMinor: marketState.lowestAskMinor ?? null,
      highestBidMinor: marketState.highestBidMinor ?? null,
      ...(marketState.metadata
        ? {
            metadata: JSON.parse(
              JSON.stringify(marketState.metadata),
            ) as Prisma.InputJsonValue,
          }
        : {}),
    } satisfies Prisma.InputJsonObject;
  }

  private normalizeTitle(title: string): string {
    return this.aliasNormalizationService.normalizeMarketHashName(title);
  }
}
