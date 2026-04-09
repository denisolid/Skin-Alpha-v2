import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';
import type {
  FindScannerUniverseCandidatesInput,
  OpportunitiesRepository,
  ScannerUniverseCandidateRecord,
} from '../domain/opportunities.repository';

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

  async findScannerUniverseVariant(
    itemVariantId: string,
  ): Promise<ScannerUniverseCandidateRecord | null> {
    const candidates = await this.findScannerUniverseCandidates({
      itemVariantIds: [itemVariantId],
      limit: 1,
    });

    return candidates[0] ?? null;
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
