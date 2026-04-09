import {
  BadRequestException,
  ConflictException,
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
import { parseOpportunityKey } from '../domain/opportunity-key';
import type { OpportunityEvaluationDto } from '../dto/opportunity-engine.dto';
import type { CompiledScheme } from '../../schemes/domain/scheme.model';
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

  async getFullFeedForScheme(
    scheme: CompiledScheme,
    query: GetOpportunityFeedQueryDto = {},
  ): Promise<OpportunityFullFeedPageDto> {
    const feed = await this.buildFeed(query, {
      includeRejected: false,
      scheme,
    });

    return {
      pageInfo: feed.pageInfo,
      filters: feed.filters,
      summary: feed.summary,
      items: feed.items.map((item) => this.toFullFeedItem(item)),
    };
  }

  async getAllFullFeedForScheme(
    scheme: CompiledScheme,
    query: GetOpportunityFeedQueryDto = {},
  ): Promise<{
    readonly generatedAt: Date;
    readonly evaluatedVariantCount: number;
    readonly sortBy: OpportunityPublicFeedPageDto['pageInfo']['sortBy'];
    readonly sortDirection: OpportunityPublicFeedPageDto['pageInfo']['sortDirection'];
    readonly filters: OpportunityFeedFiltersDto;
    readonly items: readonly OpportunityFullFeedItemDto[];
  }> {
    const feed = await this.buildFeed(query, {
      includeRejected: false,
      scheme,
    });

    return {
      generatedAt: feed.pageInfo.generatedAt,
      evaluatedVariantCount: feed.pageInfo.evaluatedVariantCount,
      sortBy: feed.pageInfo.sortBy,
      sortDirection: feed.pageInfo.sortDirection,
      filters: feed.filters,
      items: feed.allItems.map((item) => this.toFullFeedItem(item)),
    };
  }

  async getOpportunityDetail(
    opportunityKey: string,
  ): Promise<OpportunityDetailDto> {
    const record = await this.resolveOpportunityRecord(opportunityKey, {
      includeRejected: false,
      missingBehavior: 'not_found',
    });

    if (!record || record.evaluation.disposition === 'rejected') {
      throw new NotFoundException(
        `Opportunity detail '${opportunityKey}' was not found.`,
      );
    }

    return this.toFullFeedItem(record);
  }

  async getOpportunityDetailForScheme(
    scheme: CompiledScheme,
    opportunityKey: string,
  ): Promise<OpportunityDetailDto> {
    const record = await this.resolveOpportunityRecord(opportunityKey, {
      includeRejected: true,
      missingBehavior: 'conflict',
      scheme,
    });

    if (
      !record ||
      record.evaluation.disposition === 'rejected'
    ) {
      throw this.createOpportunityResolutionConflict(scheme.id, opportunityKey);
    }

    return this.toFullFeedItem(record);
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
      readonly scheme?: CompiledScheme;
    },
  ): Promise<{
    readonly pageInfo: OpportunityPublicFeedPageDto['pageInfo'];
    readonly filters: OpportunityFeedFiltersDto;
    readonly summary: OpportunityFeedSummaryDto;
    readonly items: readonly OpportunityFeedRecord[];
    readonly allItems: readonly OpportunityFeedRecord[];
  }> {
    const normalizedQuery = this.normalizeQuery(query, options.scheme);
    const schemeCategory = this.resolveSingleSchemeCategory(
      options.scheme,
      normalizedQuery.category,
    );
    const schemeTier = this.resolveSingleSchemeTier(
      options.scheme,
      normalizedQuery.tier,
    );
    const universe = await this.scannerUniverseService.getScannerUniverse({
      ...(schemeCategory ? { category: schemeCategory } : {}),
      ...(schemeTier ? { tier: schemeTier } : {}),
      ...(normalizedQuery.category
        ? { category: normalizedQuery.category }
        : {}),
      ...(normalizedQuery.tier ? { tier: normalizedQuery.tier } : {}),
      limit: this.resolveUniverseLimit(normalizedQuery),
    });
    const filteredUniverseItems = universe.items.filter((item) =>
      this.matchesUniverseItem(item, normalizedQuery, options.scheme),
    );
    const evaluations = await Promise.all(
      filteredUniverseItems.map((item) =>
        this.opportunityEngineService.evaluateVariant(item.itemVariantId, {
          includeRejected: options.includeRejected,
          maxPairs: DEFAULT_FEED_MAX_PAIRS_PER_ITEM,
          ...(options.scheme ? { scheme: options.scheme } : {}),
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
      this.matchesEvaluation(
        record,
        normalizedQuery,
        options.includeRejected,
      ),
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
    scheme?: CompiledScheme,
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
      pageSize: query.pageSize ?? scheme?.view.defaultPageSize ?? DEFAULT_FEED_PAGE_SIZE,
      sortBy:
        query.sortBy ??
        scheme?.view.defaultSortBy ??
        DEFAULT_FEED_SORT_BY,
      sortDirection:
        query.sortDirection ??
        scheme?.view.defaultSortDirection ??
        DEFAULT_FEED_SORT_DIRECTION,
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
    scheme?: CompiledScheme,
  ): boolean {
    if (scheme) {
      if (
        scheme.scope.categories.length > 0 &&
        !scheme.scope.categories.includes(item.category)
      ) {
        return false;
      }

      if (scheme.scope.tiers.length > 0 && !scheme.scope.tiers.includes(item.tier)) {
        return false;
      }

      if (
        scheme.scope.itemTypes.length > 0 &&
        !scheme.scope.itemTypes.includes(this.normalizeItemType(item.itemType))
      ) {
        return false;
      }

      if (
        scheme.scope.itemVariantIds.length > 0 &&
        !scheme.scope.itemVariantIds.includes(item.itemVariantId)
      ) {
        return false;
      }
    }

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

  private async resolveOpportunityRecord(
    opportunityKey: string,
    options: {
      readonly includeRejected: boolean;
      readonly missingBehavior: 'not_found' | 'conflict';
      readonly scheme?: CompiledScheme;
    },
  ): Promise<OpportunityFeedRecord | null> {
    const parts = parseOpportunityKey(opportunityKey);

    if (!parts) {
      throw new BadRequestException(
        `Invalid opportunityKey '${opportunityKey}'.`,
      );
    }

    try {
      const [item, evaluationResult] = await Promise.all([
        this.scannerUniverseService.getScannerUniverseItem(parts.itemVariantId),
        this.opportunityEngineService.evaluateVariant(parts.itemVariantId, {
          includeRejected: options.includeRejected,
          maxPairs: DEFAULT_FEED_MAX_PAIRS_PER_ITEM,
          ...(options.scheme ? { scheme: options.scheme } : {}),
        }),
      ]);
      const evaluation = evaluationResult.evaluations.find(
        (candidate) => candidate.opportunityKey === opportunityKey,
      );

      if (!evaluation) {
        return null;
      }

      return this.toFeedRecord({
        item,
        evaluation,
      });
    } catch (error) {
      if (
        options.missingBehavior === 'conflict' &&
        error instanceof NotFoundException
      ) {
        throw this.createOpportunityResolutionConflict(
          options.scheme?.id,
          opportunityKey,
        );
      }

      throw error;
    }
  }

  private toFeedRecord(input: {
    readonly item: ScannerUniverseItemDto;
    readonly evaluation: OpportunityEvaluationDto;
  }): OpportunityFeedRecord {
    return {
      item: input.item,
      evaluation: input.evaluation,
      freshness: input.evaluation.rankingInputs.freshnessScore,
      liquidity: input.evaluation.rankingInputs.liquidityScore,
      observedAt: new Date(
        Math.min(
          input.evaluation.buy.observedAt.getTime(),
          input.evaluation.sell.observedAt.getTime(),
        ),
      ),
    };
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

    if (
      right.evaluation.rankingInputs.rankScore !==
      left.evaluation.rankingInputs.rankScore
    ) {
      return (
        right.evaluation.rankingInputs.rankScore -
        left.evaluation.rankingInputs.rankScore
      );
    }

    return left.evaluation.opportunityKey.localeCompare(
      right.evaluation.opportunityKey,
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
      opportunityKey: record.evaluation.opportunityKey,
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
      validation: record.evaluation.validation,
      pairability: record.evaluation.pairability,
      explainability: record.evaluation.explainability,
      rankingInputs: record.evaluation.rankingInputs,
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

  private resolveSingleSchemeCategory(
    scheme: CompiledScheme | undefined,
    queryCategory: GetOpportunityFeedQueryDto['category'] | undefined,
  ): GetOpportunityFeedQueryDto['category'] | undefined {
    if (queryCategory !== undefined) {
      return undefined;
    }

    return scheme?.scope.categories.length === 1
      ? scheme.scope.categories[0]
      : undefined;
  }

  private resolveSingleSchemeTier(
    scheme: CompiledScheme | undefined,
    queryTier: GetOpportunityFeedQueryDto['tier'] | undefined,
  ): GetOpportunityFeedQueryDto['tier'] | undefined {
    if (queryTier !== undefined) {
      return undefined;
    }

    return scheme?.scope.tiers.length === 1 ? scheme.scope.tiers[0] : undefined;
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

  private createOpportunityResolutionConflict(
    schemeId: string | undefined,
    opportunityKey: string,
  ): ConflictException {
    return new ConflictException({
      code: 'OPPORTUNITY_NO_LONGER_LIVE',
      ...(schemeId ? { schemeId } : {}),
      opportunityKey,
      message: schemeId
        ? `Opportunity '${opportunityKey}' no longer resolves for scheme '${schemeId}' from current MarketState.`
        : `Opportunity '${opportunityKey}' no longer resolves from current MarketState.`,
    });
  }
}
