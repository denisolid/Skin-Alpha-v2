import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import type { AuthUserRecord } from '../../auth/domain/auth.repository';
import {
  OPPORTUNITIES_REPOSITORY,
  type OpportunitiesRepository,
} from '../domain/opportunities.repository';
import { getScannerTierRank } from '../domain/item-tier.model';
import type { GetScannerUniverseQueryDto } from '../dto/get-scanner-universe.query.dto';
import type {
  ScannerUniverseItemDto,
  ScannerUniverseListDto,
} from '../dto/scanner-universe.dto';
import type { SetHotUniverseOverrideDto } from '../dto/set-hot-universe-override.dto';
import { ScannerUniverseAdminOverrideService } from './scanner-universe-admin-override.service';
import { ScannerUniversePolicyService } from './scanner-universe-policy.service';

const DEFAULT_UNIVERSE_LIMIT = 50;
const MAX_SCORING_CANDIDATE_LIMIT = 400;

@Injectable()
export class ScannerUniverseService {
  constructor(
    @Inject(OPPORTUNITIES_REPOSITORY)
    private readonly opportunitiesRepository: OpportunitiesRepository,
    @Inject(ScannerUniverseAdminOverrideService)
    private readonly scannerUniverseAdminOverrideService: ScannerUniverseAdminOverrideService,
    @Inject(ScannerUniversePolicyService)
    private readonly scannerUniversePolicyService: ScannerUniversePolicyService,
  ) {}

  async getScannerUniverse(
    query: GetScannerUniverseQueryDto = {},
  ): Promise<ScannerUniverseListDto> {
    const generatedAt = new Date();
    const limit = query.limit ?? DEFAULT_UNIVERSE_LIMIT;
    const hotOverrides =
      await this.scannerUniverseAdminOverrideService.listHotOverrides();
    const overrideItemVariantIds = [...hotOverrides.keys()];
    const candidateLimit = Math.min(
      MAX_SCORING_CANDIDATE_LIMIT,
      Math.max(limit * 8, DEFAULT_UNIVERSE_LIMIT * 4),
    );
    const baseCandidates = query.includeOverridesOnly
      ? []
      : await this.opportunitiesRepository.findScannerUniverseCandidates({
          limit: candidateLimit,
          ...(query.category ? { category: query.category } : {}),
        });
    const knownItemVariantIds = new Set(
      baseCandidates.map((candidate) => candidate.itemVariantId),
    );
    const missingOverrideItemVariantIds = overrideItemVariantIds.filter(
      (itemVariantId) => !knownItemVariantIds.has(itemVariantId),
    );
    const overrideCandidates = missingOverrideItemVariantIds.length
      ? await this.opportunitiesRepository.findScannerUniverseCandidates({
          limit: missingOverrideItemVariantIds.length,
          itemVariantIds: missingOverrideItemVariantIds,
        })
      : [];
    const deduplicatedCandidates = new Map(
      [...baseCandidates, ...overrideCandidates].map((candidate) => [
        candidate.itemVariantId,
        candidate,
      ]),
    );
    const evaluatedItems = [...deduplicatedCandidates.values()]
      .map((candidate) =>
        this.scannerUniversePolicyService.evaluateCandidate(
          candidate,
          generatedAt,
          hotOverrides.get(candidate.itemVariantId),
        ),
      )
      .filter((item) =>
        query.category !== undefined ? item.category === query.category : true,
      )
      .filter((item) => (query.tier ? item.tier === query.tier : true))
      .filter((item) =>
        query.includeOverridesOnly ? item.manualOverride !== undefined : true,
      )
      .sort((left, right) => this.compareItems(left, right))
      .slice(0, limit);

    return {
      generatedAt,
      summary: {
        hot: evaluatedItems.filter((item) => item.tier === 'hot').length,
        warm: evaluatedItems.filter((item) => item.tier === 'warm').length,
        cold: evaluatedItems.filter((item) => item.tier === 'cold').length,
        overridden: evaluatedItems.filter((item) => item.manualOverride).length,
      },
      items: evaluatedItems,
    };
  }

  async getScannerUniverseItem(
    itemVariantId: string,
  ): Promise<ScannerUniverseItemDto> {
    const [candidate, hotOverride] = await Promise.all([
      this.opportunitiesRepository.findScannerUniverseVariant(itemVariantId),
      this.scannerUniverseAdminOverrideService.getHotOverride(itemVariantId),
    ]);

    if (!candidate) {
      throw new NotFoundException(
        `Item variant '${itemVariantId}' was not found in scanner universe data.`,
      );
    }

    return this.scannerUniversePolicyService.evaluateCandidate(
      candidate,
      new Date(),
      hotOverride ?? undefined,
    );
  }

  async getScannerUniverseMap(
    itemVariantIds: readonly string[],
  ): Promise<ReadonlyMap<string, ScannerUniverseItemDto>> {
    const uniqueItemVariantIds = [...new Set(itemVariantIds)];

    if (uniqueItemVariantIds.length === 0) {
      return new Map();
    }

    const [candidates, hotOverrides] = await Promise.all([
      this.opportunitiesRepository.findScannerUniverseCandidates({
        limit: uniqueItemVariantIds.length,
        itemVariantIds: uniqueItemVariantIds,
      }),
      this.scannerUniverseAdminOverrideService.listHotOverrides(),
    ]);

    return new Map(
      candidates.map((candidate) => [
        candidate.itemVariantId,
        this.scannerUniversePolicyService.evaluateCandidate(
          candidate,
          new Date(),
          hotOverrides.get(candidate.itemVariantId),
        ),
      ]),
    );
  }

  async setHotOverride(
    itemVariantId: string,
    input: SetHotUniverseOverrideDto,
    user: Pick<AuthUserRecord, 'id' | 'role'>,
  ) {
    this.assertAdminUser(user);

    const candidate =
      await this.opportunitiesRepository.findScannerUniverseVariant(
        itemVariantId,
      );

    if (!candidate) {
      throw new NotFoundException(
        `Item variant '${itemVariantId}' was not found in scanner universe data.`,
      );
    }

    return this.scannerUniverseAdminOverrideService.setHotOverride({
      itemVariantId,
      createdByUserId: user.id,
      ...(input.note ? { note: input.note } : {}),
      ...(input.ttlHours !== undefined ? { ttlHours: input.ttlHours } : {}),
    });
  }

  async clearHotOverride(
    itemVariantId: string,
    user: Pick<AuthUserRecord, 'id' | 'role'>,
  ) {
    this.assertAdminUser(user);

    return this.scannerUniverseAdminOverrideService.clearHotOverride(
      itemVariantId,
    );
  }

  private assertAdminUser(user: Pick<AuthUserRecord, 'role'>): void {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'Administrator role is required for scanner universe overrides.',
      );
    }
  }

  private compareItems(
    left: ScannerUniverseItemDto,
    right: ScannerUniverseItemDto,
  ): number {
    if (Boolean(left.manualOverride) !== Boolean(right.manualOverride)) {
      return left.manualOverride ? -1 : 1;
    }

    const overlapReadinessDifference = this.compareOpportunityReadiness(
      left,
      right,
    );

    if (overlapReadinessDifference !== 0) {
      return overlapReadinessDifference;
    }

    if (
      right.sourceMetrics.usableSourceCount !==
      left.sourceMetrics.usableSourceCount
    ) {
      return (
        right.sourceMetrics.usableSourceCount -
        left.sourceMetrics.usableSourceCount
      );
    }

    if (
      right.sourceMetrics.freshSourceCount !==
      left.sourceMetrics.freshSourceCount
    ) {
      return (
        right.sourceMetrics.freshSourceCount -
        left.sourceMetrics.freshSourceCount
      );
    }

    const tierRankDifference =
      getScannerTierRank(left.tier) - getScannerTierRank(right.tier);

    if (tierRankDifference !== 0) {
      return tierRankDifference;
    }

    if (right.compositeScore !== left.compositeScore) {
      return right.compositeScore - left.compositeScore;
    }
    return left.variantDisplayName.localeCompare(right.variantDisplayName);
  }

  private compareOpportunityReadiness(
    left: ScannerUniverseItemDto,
    right: ScannerUniverseItemDto,
  ): number {
    const leftReadiness = this.getOpportunityReadinessRank(left);
    const rightReadiness = this.getOpportunityReadinessRank(right);

    return leftReadiness - rightReadiness;
  }

  private getOpportunityReadinessRank(item: ScannerUniverseItemDto): number {
    if (item.sourceMetrics.freshSourceCount >= 2) {
      return 0;
    }

    if (item.sourceMetrics.usableSourceCount >= 2) {
      return 1;
    }

    if (item.sourceMetrics.totalSourceCount >= 2) {
      return 2;
    }

    return 3;
  }
}
