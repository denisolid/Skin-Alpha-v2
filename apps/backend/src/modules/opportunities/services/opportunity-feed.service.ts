import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import type { AuthUserRecord } from '../../auth/domain/auth.repository';
import {
  SOURCE_ADAPTER_KEYS,
  type SourceAdapterKey,
} from '../../source-adapters/domain/source-adapter.types';
import type { ScannerUniverseItemDto } from '../dto/scanner-universe.dto';
import type {
  GetOpportunityDetailQueryDto,
  GetOpportunityFeedQueryDto,
  OpportunityFeedSortDirection,
  OpportunityFeedSortField,
} from '../dto/get-opportunity-feed.query.dto';
import type {
  OpportunityDetailDto,
  OpportunityFeedFiltersDto,
  OpportunityFeedSummaryDto,
  OpportunityFullFeedItemDto,
  OpportunityFullFeedPageDto,
  OpportunityPublicFeedItemDto,
  OpportunityPublicFeedPageDto,
  OpportunityRejectDiagnosticDto,
  OpportunityRejectDiagnosticsPageDto,
} from '../dto/opportunity-feed.dto';
import type { OpportunityEvaluationDto } from '../dto/opportunity-engine.dto';
import { OpportunityEngineService } from './opportunity-engine.service';
import { ScannerUniverseService } from './scanner-universe.service';

const DEFAULT_FEED_PAGE = 1;
const DEFAULT_FEED_PAGE_SIZE = 25;
const DEFAULT_FEED_SORT_BY = 'expected_profit';
const DEFAULT_FEED_SORT_DIRECTION = 'desc';
const DEFAULT_FEED_MAX_PAIRS_PER_ITEM = 64;
const MIN_FEED_VARIANT_SCAN_LIMIT = 40;
const MAX_FEED_VARIANT_SCAN_LIMIT = 160;
const FEED_VARIANT_SCAN_MULTIPLIER = 5;

interface NormalizedFeedQuery {
  readonly sourcePair?: {
    readonly key: string;
    readonly buySource: SourceAdapterKey;
    readonly sellSource: SourceAdapterKey;
  };
  readonly category?: GetOpportunityFeedQueryDto['category'];
  readonly minProfit?: number;
  readonly minConfidence?: number;
  readonly itemType?: string;
  readonly tier?: GetOpportunityFeedQueryDto['tier'];
  readonly page: number;
  readonly pageSize: number;
  readonly sortBy: OpportunityFeedSortField;
  readonly sortDirection: OpportunityFeedSortDirection;
}

interface OpportunityFeedRecord {
  readonly item: ScannerUniverseItemDto;
  readonly evaluation: OpportunityEvaluationDto;
  readonly freshness: number;
  readonly liquidity: number;
  readonly observedAt: Date;
}

@Injectable()
export class OpportunityFeedService {
  constructor(
    @Inject(ScannerUniverseService)
    private readonly scannerUniverseService: ScannerUniverseService,
    @Inject(OpportunityEngineService)
    private readonly opportunityEngineService: OpportunityEngineService,
  ) {}

  async getPublicFeed(
    query: GetOpportunityFeedQueryDto = {},
  ): Promise<OpportunityPublicFeedPageDto> {
    const feed = await this.buildFeed(query, { includeRejected: false });

    return {
      pageInfo: feed.pageInfo,
      filters: feed.filters,
      summary: feed.summary,
      items: feed.items.map((item) => this.toPublicFeedItem(item)),
    };
  }

  async getFullFeed(
    query: GetOpportunityFeedQueryDto = {},
  ): Promise<OpportunityFullFeedPageDto> {
    const feed = await this.buildFeed(query, { includeRejected: false });

    return {
      pageInfo: feed.pageInfo,
      filters: feed.filters,
      summary: feed.summary,
      items: feed.items.map((item) => this.toFullFeedItem(item)),
    };
  }

  async getOpportunityDetail(
    itemVariantId: string,
    query: GetOpportunityDetailQueryDto,
  ): Promise<OpportunityDetailDto> {
    const sourcePair = this.parseSourcePair(query.sourcePair);
    const [item, evaluationResult] = await Promise.all([
      this.scannerUniverseService.getScannerUniverseItem(itemVariantId),
      this.opportunityEngineService.evaluateVariant(itemVariantId, {
        includeRejected: false,
        maxPairs: DEFAULT_FEED_MAX_PAIRS_PER_ITEM,
      }),
    ]);
    const evaluation = evaluationResult.evaluations.find(
      (candidate) => candidate.sourcePairKey === sourcePair.key,
    );

    if (!evaluation || evaluation.disposition === 'rejected') {
      throw new NotFoundException(
        `Opportunity detail '${itemVariantId}:${sourcePair.key}' was not found.`,
      );
    }

    return this.toFullFeedItem(
      this.toFeedRecord({
        item,
        evaluation,
      }),
    );
  }

  async getRejectDiagnostics(
    query: GetOpportunityFeedQueryDto = {},
    user: Pick<AuthUserRecord, 'role'>,
  ): Promise<OpportunityRejectDiagnosticsPageDto> {
    this.assertAdminUser(user);

    const feed = await this.buildFeed(query, { includeRejected: true });
    const rejectedItems = feed.allItems.filter(
      (item) => item.evaluation.disposition === 'rejected',
    );
    const paginatedRejectedItems = feed.items.filter(
      (item) => item.evaluation.disposition === 'rejected',
    );

    return {
      pageInfo: {
        ...feed.pageInfo,
        total: rejectedItems.length,
        totalPages: this.toTotalPages(
          rejectedItems.length,
          feed.pageInfo.pageSize,
        ),
      },
      filters: feed.filters,
      totalRejected: rejectedItems.length,
      items: paginatedRejectedItems.map((item) =>
        this.toRejectDiagnosticItem(item),
      ),
    };
  }

  private async buildFeed(
    query: GetOpportunityFeedQueryDto,
    options: {
      readonly includeRejected: boolean;
    },
  ): Promise<{
    readonly pageInfo: OpportunityPublicFeedPageDto['pageInfo'];
    readonly filters: OpportunityFeedFiltersDto;
    readonly summary: OpportunityFeedSummaryDto;
    readonly items: readonly OpportunityFeedRecord[];
    readonly allItems: readonly OpportunityFeedRecord[];
  }> {
    const normalizedQuery = this.normalizeQuery(query);
    const universe = await this.scannerUniverseService.getScannerUniverse({
      ...(normalizedQuery.category
        ? { category: normalizedQuery.category }
        : {}),
      ...(normalizedQuery.tier ? { tier: normalizedQuery.tier } : {}),
      limit: this.resolveUniverseLimit(normalizedQuery),
    });
    const filteredUniverseItems = universe.items.filter((item) =>
      this.matchesUniverseItem(item, normalizedQuery),
    );
    const evaluations = await Promise.all(
      filteredUniverseItems.map((item) =>
        this.opportunityEngineService.evaluateVariant(item.itemVariantId, {
          includeRejected: options.includeRejected,
          maxPairs: DEFAULT_FEED_MAX_PAIRS_PER_ITEM,
        }),
      ),
    );
    const feedRecords = evaluations.flatMap((result) => {
      const item = filteredUniverseItems.find(
        (candidate) => candidate.itemVariantId === result.itemVariantId,
      );

      if (!item) {
        return [];
      }

      return result.evaluations.map((evaluation) =>
        this.toFeedRecord({
          item,
          evaluation,
        }),
      );
    });
    const filteredRecords = feedRecords.filter((record) =>
      this.matchesEvaluation(record, normalizedQuery, options.includeRejected),
    );
    const sortedRecords = [...filteredRecords].sort((left, right) =>
      this.compareFeedRecords(
        left,
        right,
        normalizedQuery.sortBy,
        normalizedQuery.sortDirection,
      ),
    );
    const pageOffset = (normalizedQuery.page - 1) * normalizedQuery.pageSize;
    const paginatedRecords = sortedRecords.slice(
      pageOffset,
      pageOffset + normalizedQuery.pageSize,
    );

    return {
      pageInfo: {
        generatedAt: new Date(),
        page: normalizedQuery.page,
        pageSize: normalizedQuery.pageSize,
        total: sortedRecords.length,
        totalPages: this.toTotalPages(
          sortedRecords.length,
          normalizedQuery.pageSize,
        ),
        evaluatedVariantCount: filteredUniverseItems.length,
        sortBy: normalizedQuery.sortBy,
        sortDirection: normalizedQuery.sortDirection,
      },
      filters: {
        ...(normalizedQuery.sourcePair
          ? { sourcePair: normalizedQuery.sourcePair.key }
          : {}),
        ...(normalizedQuery.category
          ? { category: normalizedQuery.category }
          : {}),
        ...(normalizedQuery.minProfit !== undefined
          ? { minProfit: normalizedQuery.minProfit }
          : {}),
        ...(normalizedQuery.minConfidence !== undefined
          ? { minConfidence: normalizedQuery.minConfidence }
          : {}),
        ...(normalizedQuery.itemType
          ? { itemType: normalizedQuery.itemType }
          : {}),
        ...(normalizedQuery.tier ? { tier: normalizedQuery.tier } : {}),
      },
      summary: this.createSummary(filteredRecords),
      items: paginatedRecords,
      allItems: sortedRecords,
    };
  }

  private normalizeQuery(
    query: GetOpportunityFeedQueryDto,
  ): NormalizedFeedQuery {
    return {
      ...(query.sourcePair
        ? { sourcePair: this.parseSourcePair(query.sourcePair) }
        : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.minProfit !== undefined ? { minProfit: query.minProfit } : {}),
      ...(query.minConfidence !== undefined
        ? { minConfidence: query.minConfidence }
        : {}),
      ...(query.itemType
        ? { itemType: this.normalizeItemType(query.itemType) }
        : {}),
      ...(query.tier ? { tier: query.tier } : {}),
      page: query.page ?? DEFAULT_FEED_PAGE,
      pageSize: query.pageSize ?? DEFAULT_FEED_PAGE_SIZE,
      sortBy: query.sortBy ?? DEFAULT_FEED_SORT_BY,
      sortDirection: query.sortDirection ?? DEFAULT_FEED_SORT_DIRECTION,
    };
  }

  private parseSourcePair(sourcePair: string): {
    readonly key: string;
    readonly buySource: SourceAdapterKey;
    readonly sellSource: SourceAdapterKey;
  } {
    const [buySource, sellSource] = sourcePair.split('->');

    if (
      !buySource ||
      !sellSource ||
      !SOURCE_ADAPTER_KEYS.includes(buySource as SourceAdapterKey) ||
      !SOURCE_ADAPTER_KEYS.includes(sellSource as SourceAdapterKey)
    ) {
      throw new BadRequestException(
        `Invalid sourcePair '${sourcePair}'. Expected '<buySource>-><sellSource>'.`,
      );
    }

    return {
      key: `${buySource}->${sellSource}`,
      buySource: buySource as SourceAdapterKey,
      sellSource: sellSource as SourceAdapterKey,
    };
  }

  private matchesUniverseItem(
    item: ScannerUniverseItemDto,
    query: NormalizedFeedQuery,
  ): boolean {
    if (
      query.itemType &&
      this.normalizeItemType(item.itemType) !== query.itemType
    ) {
      return false;
    }

    return true;
  }

  private matchesEvaluation(
    record: OpportunityFeedRecord,
    query: NormalizedFeedQuery,
    includeRejected: boolean,
  ): boolean {
    if (!includeRejected && record.evaluation.disposition === 'rejected') {
      return false;
    }

    if (includeRejected && record.evaluation.disposition !== 'rejected') {
      return false;
    }

    if (
      query.sourcePair &&
      record.evaluation.sourcePairKey !== query.sourcePair.key
    ) {
      return false;
    }

    if (
      query.category !== undefined &&
      record.evaluation.category !== query.category
    ) {
      return false;
    }

    if (query.minProfit !== undefined) {
      if (record.evaluation.expectedNetProfit < query.minProfit) {
        return false;
      }
    }

    if (query.minConfidence !== undefined) {
      if (record.evaluation.finalConfidence < query.minConfidence) {
        return false;
      }
    }

    if (query.itemType) {
      if (this.normalizeItemType(record.item.itemType) !== query.itemType) {
        return false;
      }
    }

    if (query.tier && record.item.tier !== query.tier) {
      return false;
    }

    return true;
  }

  private toFeedRecord(input: {
    readonly item: ScannerUniverseItemDto;
    readonly evaluation: OpportunityEvaluationDto;
  }): OpportunityFeedRecord {
    return {
      item: input.item,
      evaluation: input.evaluation,
      freshness: this.computeFreshness(input.evaluation),
      liquidity: this.computeLiquidity(input.evaluation),
      observedAt: new Date(
        Math.min(
          input.evaluation.buy.observedAt.getTime(),
          input.evaluation.sell.observedAt.getTime(),
        ),
      ),
    };
  }

  private computeFreshness(evaluation: OpportunityEvaluationDto): number {
    return this.clampScore(
      1 -
        evaluation.penalties.freshnessPenalty -
        evaluation.penalties.stalePenalty,
    );
  }

  private computeLiquidity(evaluation: OpportunityEvaluationDto): number {
    const buyListedQty = evaluation.buy.listedQty ?? 0;
    const sellListedQty = evaluation.sell.listedQty ?? 0;
    const depthSignal = Math.min(1, Math.min(buyListedQty, sellListedQty) / 12);

    return this.clampScore(
      1 - evaluation.penalties.liquidityPenalty * 0.9 + depthSignal * 0.1,
    );
  }

  private compareFeedRecords(
    left: OpportunityFeedRecord,
    right: OpportunityFeedRecord,
    sortBy: OpportunityFeedSortField,
    sortDirection: OpportunityFeedSortDirection,
  ): number {
    const directionMultiplier = sortDirection === 'asc' ? 1 : -1;
    const baseComparison = this.compareBySortField(left, right, sortBy);

    if (baseComparison !== 0) {
      return baseComparison * directionMultiplier;
    }

    if (
      right.evaluation.expectedNetProfit !== left.evaluation.expectedNetProfit
    ) {
      return (
        right.evaluation.expectedNetProfit - left.evaluation.expectedNetProfit
      );
    }

    if (right.evaluation.finalConfidence !== left.evaluation.finalConfidence) {
      return right.evaluation.finalConfidence - left.evaluation.finalConfidence;
    }

    return left.evaluation.sourcePairKey.localeCompare(
      right.evaluation.sourcePairKey,
    );
  }

  private compareBySortField(
    left: OpportunityFeedRecord,
    right: OpportunityFeedRecord,
    sortBy: OpportunityFeedSortField,
  ): number {
    switch (sortBy) {
      case 'expected_profit':
        return (
          left.evaluation.expectedNetProfit - right.evaluation.expectedNetProfit
        );
      case 'confidence':
        return (
          left.evaluation.finalConfidence - right.evaluation.finalConfidence
        );
      case 'freshness':
        return left.freshness - right.freshness;
      case 'liquidity':
        return left.liquidity - right.liquidity;
    }
  }

  private toPublicFeedItem(
    record: OpportunityFeedRecord,
  ): OpportunityPublicFeedItemDto {
    return {
      disposition: record.evaluation.disposition,
      riskClass: record.evaluation.riskClass,
      category: record.evaluation.category,
      itemType: record.item.itemType,
      tier: record.item.tier,
      canonicalDisplayName: record.evaluation.canonicalDisplayName,
      variantDisplayName: record.evaluation.variantDisplayName,
      itemVariantId: record.evaluation.itemVariantId,
      sourcePairKey: record.evaluation.sourcePairKey,
      buySource: record.evaluation.buy.source,
      buySourceName: record.evaluation.buy.sourceName,
      sellSource: record.evaluation.sell.source,
      sellSourceName: record.evaluation.sell.sourceName,
      expectedNetProfit: record.evaluation.expectedNetProfit,
      finalConfidence: record.evaluation.finalConfidence,
      freshness: record.freshness,
      liquidity: record.liquidity,
      observedAt: record.observedAt,
    };
  }

  private toFullFeedItem(
    record: OpportunityFeedRecord,
  ): OpportunityFullFeedItemDto {
    return {
      ...this.toPublicFeedItem(record),
      canonicalItemId: record.evaluation.canonicalItemId,
      rawSpread: record.evaluation.rawSpread,
      rawSpreadPercent: record.evaluation.rawSpreadPercent,
      feesAdjustedSpread: record.evaluation.feesAdjustedSpread,
      expectedExitPrice: record.evaluation.expectedExitPrice,
      estimatedSellFeeRate: record.evaluation.estimatedSellFeeRate,
      buyCost: record.evaluation.buyCost,
      sellSignalPrice: record.evaluation.sellSignalPrice,
      buy: record.evaluation.buy,
      sell: record.evaluation.sell,
      ...(record.evaluation.backupConfirmation
        ? { backupConfirmation: record.evaluation.backupConfirmation }
        : {}),
    };
  }

  private toRejectDiagnosticItem(
    record: OpportunityFeedRecord,
  ): OpportunityRejectDiagnosticDto {
    return {
      ...this.toFullFeedItem(record),
      reasonCodes: record.evaluation.reasonCodes,
      penalties: record.evaluation.penalties,
      antiFakeAssessment: record.evaluation.antiFakeAssessment,
    };
  }

  private createSummary(
    items: readonly OpportunityFeedRecord[],
  ): OpportunityFeedSummaryDto {
    let candidate = 0;
    let nearEligible = 0;
    let eligible = 0;
    let riskyHighUpside = 0;

    for (const item of items) {
      switch (item.evaluation.disposition) {
        case 'candidate':
          candidate += 1;
          break;
        case 'near_eligible':
          nearEligible += 1;
          break;
        case 'eligible':
          eligible += 1;
          break;
        case 'risky_high_upside':
          riskyHighUpside += 1;
          break;
        case 'rejected':
          break;
      }
    }

    return {
      candidate,
      nearEligible,
      eligible,
      riskyHighUpside,
    };
  }

  private resolveUniverseLimit(query: NormalizedFeedQuery): number {
    return Math.min(
      MAX_FEED_VARIANT_SCAN_LIMIT,
      Math.max(
        MIN_FEED_VARIANT_SCAN_LIMIT,
        query.page * query.pageSize * FEED_VARIANT_SCAN_MULTIPLIER,
      ),
    );
  }

  private normalizeItemType(itemType: string): string {
    return itemType.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private clampScore(value: number): number {
    return Number(Math.max(0, Math.min(1, value)).toFixed(4));
  }

  private toTotalPages(total: number, pageSize: number): number {
    return Math.max(1, Math.ceil(total / pageSize));
  }

  private assertAdminUser(user: Pick<AuthUserRecord, 'role'>): void {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'Administrator role is required for reject diagnostics.',
      );
    }
  }
}
