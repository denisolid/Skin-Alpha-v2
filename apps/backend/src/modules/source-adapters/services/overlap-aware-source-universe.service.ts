import { ListingStatus } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  ManagedMarketBatchPlanDto,
  ManagedMarketTargetDto,
} from '../domain/managed-market-source.types';
import type { SourceAdapterKey } from '../domain/source-adapter.types';
import { SourceRecordService } from './source-record.service';
import { ManagedMarketNamingService } from './managed-market-naming.service';

interface SelectOverlapAwareBatchesInput {
  readonly source: SourceAdapterKey;
  readonly batchBudget: number;
  readonly batchSize: number;
  readonly staleAfterMs: number;
  readonly candidateMultiplier?: number;
  readonly targetItemVariantIds?: readonly string[];
  readonly force?: boolean;
}

interface CandidateVariant {
  readonly canonicalItemId: string;
  readonly itemVariantId: string;
  readonly marketHashName: string;
  readonly priorityScore: number;
  readonly priorityReason: string;
  readonly overlapSourceCodes: readonly SourceAdapterKey[];
  readonly existingSourceCount: number;
}

const CORE_OVERLAP_SOURCES: readonly SourceAdapterKey[] = [
  'skinport',
  'csfloat',
  'steam-snapshot',
  'bitskins',
];

@Injectable()
export class OverlapAwareSourceUniverseService {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(SourceRecordService)
    private readonly sourceRecordService: SourceRecordService,
    @Inject(ManagedMarketNamingService)
    private readonly managedMarketNamingService: ManagedMarketNamingService,
  ) {}

  async selectPriorityBatches(
    input: SelectOverlapAwareBatchesInput,
  ): Promise<readonly ManagedMarketBatchPlanDto[]> {
    const source = await this.sourceRecordService.resolveByKey(input.source);
    const candidateLimit = Math.max(
      input.batchBudget * input.batchSize,
      input.batchBudget * input.batchSize * (input.candidateMultiplier ?? 6),
    );
    const variants = await this.prismaService.itemVariant.findMany({
      where: {
        ...(input.targetItemVariantIds?.length
          ? {
              id: {
                in: [...input.targetItemVariantIds],
              },
            }
          : {
              marketStates: {
                some: {
                  sourceId: {
                    not: source.id,
                  },
                },
              },
            }),
      },
      take: candidateLimit,
      orderBy: [
        {
          marketStates: {
            _count: 'desc',
          },
        },
        {
          updatedAt: 'desc',
        },
        {
          sortOrder: 'asc',
        },
      ],
      include: {
        canonicalItem: {
          select: {
            id: true,
            displayName: true,
          },
        },
        marketStates: {
          include: {
            source: {
              select: {
                code: true,
                metadata: true,
              },
            },
          },
          orderBy: {
            observedAt: 'desc',
          },
        },
        sourceListings: {
          where: {
            listingStatus: ListingStatus.ACTIVE,
          },
          select: {
            title: true,
            updatedAt: true,
          },
          orderBy: {
            updatedAt: 'desc',
          },
          take: 1,
        },
      },
    });
    const now = Date.now();
    const candidates = variants
      .map((variant): CandidateVariant | null => {
        const existingSources = variant.marketStates
          .map((marketState) => marketState.source.code as SourceAdapterKey)
          .filter((sourceCode) => sourceCode !== input.source);
        const uniqueExistingSources = [...new Set(existingSources)];
        const targetState = variant.marketStates.find(
          (marketState) => marketState.sourceId === source.id,
        );

        if (
          !input.force &&
          targetState &&
          now - targetState.observedAt.getTime() < input.staleAfterMs
        ) {
          return null;
        }

        const marketHashName =
          this.managedMarketNamingService.buildMarketHashName({
            canonicalDisplayName: variant.canonicalItem.displayName,
            variantDisplayName: variant.displayName,
            variantKey: variant.variantKey,
            variantMetadata: variant.metadata,
            sourceListingTitle: variant.sourceListings[0]?.title ?? null,
          });
        const overlapPriority = this.computeOverlapPriority(
          uniqueExistingSources,
        );
        const targetFreshnessPenalty = targetState
          ? Math.max(
              0,
              50 -
                Math.min(50, (now - targetState.observedAt.getTime()) / 60_000),
            )
          : 120;
        const latestObservedAt = variant.marketStates[0]?.observedAt;
        const recencyBoost = latestObservedAt
          ? Math.max(0, 45 - (now - latestObservedAt.getTime()) / 120_000)
          : 0;
        const priorityReason = this.resolvePriorityReason(
          uniqueExistingSources,
        );

        return {
          canonicalItemId: variant.canonicalItem.id,
          itemVariantId: variant.id,
          marketHashName,
          priorityScore: Number(
            (
              overlapPriority +
              targetFreshnessPenalty +
              recencyBoost +
              uniqueExistingSources.length * 35
            ).toFixed(2),
          ),
          priorityReason,
          overlapSourceCodes: uniqueExistingSources,
          existingSourceCount: uniqueExistingSources.length,
        };
      })
      .filter((candidate): candidate is CandidateVariant => candidate !== null)
      .sort((left, right) => right.priorityScore - left.priorityScore)
      .slice(0, input.batchBudget * input.batchSize);
    const batches: ManagedMarketBatchPlanDto[] = [];

    for (let index = 0; index < candidates.length; index += input.batchSize) {
      const targets = candidates.slice(index, index + input.batchSize).map(
        (candidate): ManagedMarketTargetDto => ({
          canonicalItemId: candidate.canonicalItemId,
          itemVariantId: candidate.itemVariantId,
          marketHashName: candidate.marketHashName,
          priorityScore: candidate.priorityScore,
          priorityReason: candidate.priorityReason,
          existingSourceCount: candidate.existingSourceCount,
          overlapSourceCodes: candidate.overlapSourceCodes,
        }),
      );

      batches.push({
        batchId: `${input.source}:${index / input.batchSize + 1}:${Date.now()}`,
        targets,
      });
    }

    return batches;
  }

  private computeOverlapPriority(
    existingSources: readonly SourceAdapterKey[],
  ): number {
    const uniqueSources = new Set(existingSources);
    const coreOverlapCount = CORE_OVERLAP_SOURCES.filter((sourceCode) =>
      uniqueSources.has(sourceCode),
    ).length;
    const hasThreeWayPotential = uniqueSources.size >= 2 ? 1 : 0;

    return (
      coreOverlapCount * 220 +
      uniqueSources.size * 95 +
      hasThreeWayPotential * 140 +
      (uniqueSources.has('backup-aggregator') ? 20 : 0)
    );
  }

  private resolvePriorityReason(
    existingSources: readonly SourceAdapterKey[],
  ): string {
    const uniqueSources = new Set(existingSources);
    const coreOverlapCount = CORE_OVERLAP_SOURCES.filter((sourceCode) =>
      uniqueSources.has(sourceCode),
    ).length;

    if (coreOverlapCount >= 2) {
      return 'cross-market-overlap-anchor';
    }

    if (uniqueSources.size >= 2) {
      return 'multi-source-expansion';
    }

    if (uniqueSources.has('steam-snapshot')) {
      return 'steam-hot-universe-alignment';
    }

    if (uniqueSources.size === 1) {
      return 'single-source-hot-universe-followup';
    }

    return 'broad-hot-universe-bootstrap';
  }
}
