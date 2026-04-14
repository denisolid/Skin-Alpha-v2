import { ProvenanceEntityKind } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { NormalizedListingStorageResultDto } from '../dto/normalized-listing-storage-result.dto';
import type { NormalizedMarketFactStorageResultDto } from '../dto/normalized-market-fact-storage-result.dto';
import type { NormalizedSourcePayloadDto } from '../dto/normalized-source-payload.dto';
import { SourceRecordService } from './source-record.service';

@Injectable()
export class SourceProvenanceService {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(SourceRecordService)
    private readonly sourceRecordService: SourceRecordService,
  ) {}

  async recordListings(
    input: NormalizedSourcePayloadDto,
    storageResult: NormalizedListingStorageResultDto,
  ): Promise<void> {
    if (storageResult.storedListings.length === 0) {
      return;
    }

    const source = await this.sourceRecordService.resolveByKey(input.source);
    const listingByExternalId = new Map(
      input.listings.map((listing) => [listing.externalListingId, listing]),
    );

    await this.prismaService.sourceEntityProvenance.createMany({
      skipDuplicates: true,
      data: storageResult.storedListings
        .map((storedListing) => {
          const listing = listingByExternalId.get(storedListing.externalListingId);

          if (!listing) {
            return null;
          }

          return {
            sourceId: source.id,
            rawPayloadArchiveId: input.rawPayloadArchiveId,
            ...(input.fetchJobId ? { fetchJobId: input.fetchJobId } : {}),
            ...(input.jobRunId ? { jobRunId: input.jobRunId } : {}),
            entityKind: ProvenanceEntityKind.SOURCE_LISTING,
            entityRecordId: storedListing.id,
            observedAt: listing.observedAt,
          };
        })
        .filter((value): value is NonNullable<typeof value> => value !== null),
    });
  }

  async recordMarketFacts(
    input: NormalizedSourcePayloadDto,
    storageResult: NormalizedMarketFactStorageResultDto,
  ): Promise<void> {
    if (storageResult.storedFacts.length === 0) {
      return;
    }

    const source = await this.sourceRecordService.resolveByKey(input.source);

    await this.prismaService.sourceEntityProvenance.createMany({
      skipDuplicates: true,
      data: storageResult.storedFacts.map((storedFact) => ({
        sourceId: source.id,
        rawPayloadArchiveId: input.rawPayloadArchiveId,
        ...(input.fetchJobId ? { fetchJobId: input.fetchJobId } : {}),
        ...(input.jobRunId ? { jobRunId: input.jobRunId } : {}),
        entityKind: ProvenanceEntityKind.SOURCE_MARKET_FACT,
        entityRecordId: storedFact.id,
        observedAt: storedFact.observedAt,
      })),
    });
  }
}
