import { OpportunityStatus, Prisma } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';
import type {
  FindMaterializedOpportunitiesInput,
  FindScannerUniverseCandidatesInput,
  LatestOpportunityRescanRecord,
  MaterializedOpportunityRecord,
  OpportunitiesRepository,
  ScannerUniverseCandidateRecord,
} from '../domain/opportunities.repository';
import { OPPORTUNITY_RESCAN_QUEUE_NAME } from '../../jobs/domain/jobs-scheduler.constants';

@Injectable()
export class OpportunitiesRepositoryAdapter implements OpportunitiesRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
  ) {}

  async findScannerUniverseCandidates(
    input: FindScannerUniverseCandidatesInput,
  ): Promise<readonly ScannerUniverseCandidateRecord[]> {
    const variants = await this.prismaService.itemVariant.findMany({
      where: {
        ...(input.category
          ? {
              canonicalItem: {
                category: input.category,
              },
            }
          : {}),
        ...(input.itemVariantIds?.length
          ? {
              id: {
                in: [...input.itemVariantIds],
              },
            }
          : {}),
      },
      include: {
        canonicalItem: {
          select: {
            id: true,
            displayName: true,
            category: true,
            weaponName: true,
            metadata: true,
          },
        },
        marketStates: {
          include: {
            source: {
              select: {
                code: true,
                name: true,
                kind: true,
                metadata: true,
              },
            },
          },
          orderBy: {
            observedAt: 'desc',
          },
        },
      },
      ...(input.itemVariantIds?.length ? {} : { take: input.limit }),
      orderBy: [
        {
          marketStates: {
            _count: 'desc',
          },
        },
        { updatedAt: 'desc' },
        { sortOrder: 'asc' },
      ],
    });

    return variants.map((variant) => ({
      canonicalItemId: variant.canonicalItem.id,
      canonicalDisplayName: variant.canonicalItem.displayName,
      category: variant.canonicalItem.category,
      itemType: this.resolveItemType({
        category: variant.canonicalItem.category,
        weaponName: variant.canonicalItem.weaponName,
        metadata: variant.canonicalItem.metadata,
      }),
      itemVariantId: variant.id,
      variantDisplayName: variant.displayName,
      marketStates: variant.marketStates.map((marketState) => ({
        sourceCode: marketState.source.code as SourceAdapterKey,
        sourceName: marketState.source.name,
        sourceKind: marketState.source.kind,
        sourceMetadata: marketState.source.metadata,
        observedAt: marketState.observedAt,
        confidence: marketState.confidence,
        liquidityScore: marketState.liquidityScore,
        listingCount: marketState.listingCount,
        lowestAskGross: marketState.lowestAskGross,
        average24hGross: marketState.average24hGross,
        lastTradeGross: marketState.lastTradeGross,
      })),
    }));
  }

  async findOverlapScannerUniverseCandidates(): Promise<
    readonly ScannerUniverseCandidateRecord[]
  > {
    const overlapRows = await this.prismaService.$queryRaw<
      readonly { readonly itemVariantId: string }[]
    >(Prisma.sql`
      SELECT ms."itemVariantId"
      FROM "MarketState" AS ms
      GROUP BY ms."itemVariantId"
      HAVING COUNT(*) >= 2
    `);

    if (overlapRows.length === 0) {
      return [];
    }

    return this.findScannerUniverseCandidates({
      limit: overlapRows.length,
      itemVariantIds: overlapRows.map((row) => row.itemVariantId),
    });
  }

  async findScannerUniverseVariant(
    itemVariantId: string,
  ): Promise<ScannerUniverseCandidateRecord | null> {
    const candidates = await this.findScannerUniverseCandidates({
      itemVariantIds: [itemVariantId],
      limit: 1,
    });

    return candidates[0] ?? null;
  }

  async listMaterializedOpportunities(
    input: FindMaterializedOpportunitiesInput,
  ): Promise<readonly MaterializedOpportunityRecord[]> {
    const opportunities = await this.prismaService.opportunity.findMany({
      where: {
        status: OpportunityStatus.OPEN,
        detectedAt: {
          gte: input.detectedAfter,
        },
        AND: [
          {
            OR: [
              {
                expiresAt: null,
              },
              {
                expiresAt: {
                  gt: input.now,
                },
              },
            ],
          },
        ],
        ...(input.category
          ? {
              canonicalItem: {
                category: input.category,
              },
            }
          : {}),
        ...(input.itemVariantId
          ? {
              itemVariantId: input.itemVariantId,
            }
          : {}),
        ...(input.itemVariantIds?.length
          ? {
              itemVariantId: {
                in: [...input.itemVariantIds],
              },
            }
          : {}),
        ...(input.sourcePair
          ? {
              buySource: {
                code: input.sourcePair.buySource,
              },
              sellSource: {
                code: input.sourcePair.sellSource,
              },
            }
          : {}),
        ...(input.minExpectedNet !== undefined
          ? {
              expectedNet: {
                gte: new Prisma.Decimal(input.minExpectedNet.toFixed(4)),
              },
            }
          : {}),
        ...(input.minConfidence !== undefined
          ? {
              confidence: {
                gte: new Prisma.Decimal(input.minConfidence.toFixed(4)),
              },
            }
          : {}),
      },
      include: {
        canonicalItem: {
          select: {
            displayName: true,
            category: true,
            weaponName: true,
            metadata: true,
          },
        },
        itemVariant: {
          select: {
            displayName: true,
            variantKey: true,
            metadata: true,
          },
        },
        buySource: {
          select: {
            id: true,
            code: true,
            name: true,
            kind: true,
            metadata: true,
          },
        },
        sellSource: {
          select: {
            id: true,
            code: true,
            name: true,
            kind: true,
            metadata: true,
          },
        },
      },
      orderBy: [
        {
          detectedAt: 'desc',
        },
        {
          updatedAt: 'desc',
        },
      ],
    });

    return opportunities.map((opportunity) => ({
      id: opportunity.id,
      canonicalItemId: opportunity.canonicalItemId,
      itemVariantId: opportunity.itemVariantId,
      buySnapshotId: opportunity.buySnapshotId,
      sellSnapshotId: opportunity.sellSnapshotId,
      riskClass: opportunity.riskClass,
      spreadAbsolute: opportunity.spreadAbsolute,
      spreadPercent: opportunity.spreadPercent,
      expectedNet: opportunity.expectedNet,
      ...(opportunity.expectedFees !== null
        ? { expectedFees: opportunity.expectedFees }
        : {}),
      confidence: opportunity.confidence,
      detectedAt: opportunity.detectedAt,
      ...(opportunity.expiresAt ? { expiresAt: opportunity.expiresAt } : {}),
      notes: opportunity.notes,
      canonicalItemDisplayName: opportunity.canonicalItem.displayName,
      category: opportunity.canonicalItem.category,
      ...(opportunity.canonicalItem.weaponName
        ? { canonicalItemWeaponName: opportunity.canonicalItem.weaponName }
        : {}),
      canonicalItemMetadata: opportunity.canonicalItem.metadata,
      itemVariantDisplayName: opportunity.itemVariant.displayName,
      itemVariantKey: opportunity.itemVariant.variantKey,
      itemVariantMetadata: opportunity.itemVariant.metadata,
      buySource: {
        id: opportunity.buySource.id,
        code: opportunity.buySource.code as SourceAdapterKey,
        name: opportunity.buySource.name,
        kind: opportunity.buySource.kind,
        metadata: opportunity.buySource.metadata,
      },
      sellSource: {
        id: opportunity.sellSource.id,
        code: opportunity.sellSource.code as SourceAdapterKey,
        name: opportunity.sellSource.name,
        kind: opportunity.sellSource.kind,
        metadata: opportunity.sellSource.metadata,
      },
    }));
  }

  async findLatestMaterializedOpportunity(
    input: FindMaterializedOpportunitiesInput & {
      readonly sourcePair: {
        readonly buySource: SourceAdapterKey;
        readonly sellSource: SourceAdapterKey;
      };
      readonly itemVariantId: string;
    },
  ): Promise<MaterializedOpportunityRecord | null> {
    const opportunities = await this.listMaterializedOpportunities(input);

    return opportunities[0] ?? null;
  }

  async findLatestOpportunityRescan(): Promise<LatestOpportunityRescanRecord | null> {
    const jobRun = await this.prismaService.jobRun.findFirst({
      where: {
        queueName: OPPORTUNITY_RESCAN_QUEUE_NAME,
        status: 'SUCCEEDED',
        result: {
          not: Prisma.JsonNull,
        },
        finishedAt: {
          not: null,
        },
      },
      select: {
        finishedAt: true,
        result: true,
      },
      orderBy: {
        finishedAt: 'desc',
      },
    });

    if (!jobRun?.finishedAt) {
      return null;
    }

    return {
      completedAt: jobRun.finishedAt,
      result: jobRun.result,
    };
  }

  private resolveItemType(input: {
    readonly category: ScannerUniverseCandidateRecord['category'];
    readonly weaponName: string | null;
    readonly metadata: unknown;
  }): string {
    if (typeof input.weaponName === 'string' && input.weaponName.length > 0) {
      return input.weaponName;
    }

    if (
      input.metadata &&
      typeof input.metadata === 'object' &&
      !Array.isArray(input.metadata)
    ) {
      const mapping = (input.metadata as Record<string, unknown>).mapping;

      if (
        mapping &&
        typeof mapping === 'object' &&
        !Array.isArray(mapping) &&
        typeof (mapping as Record<string, unknown>).type === 'string'
      ) {
        return (mapping as Record<string, unknown>).type as string;
      }
    }

    return input.category.toLowerCase();
  }
}
