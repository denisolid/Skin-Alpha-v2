import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import type { AuthUserRecord } from '../../auth/domain/auth.repository';
import { ReadPathDegradationService } from '../../../infrastructure/redis/read-path-degradation.service';
import { MarketFreshnessPolicyService } from '../../market-state/services/market-freshness-policy.service';
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
  OpportunityFeedDiagnosticsDto,
  OpportunityFeedFiltersDto,
  OpportunityFeedSummaryDto,
  OpportunityFullFeedItemDto,
  OpportunityFullFeedPageDto,
  OpportunityPublicFeedItemDto,
  OpportunityPublicFeedPageDto,
  OpportunityRejectDiagnosticDto,
  OpportunityRejectDiagnosticsPageDto,
} from '../dto/opportunity-feed.dto';
import type {
  OpportunityBlockerReason,
  OpportunityReasonCode,
  OpportunityRiskReasonCode,
} from '../domain/opportunity-engine.model';
import { OPPORTUNITY_RISK_REASON_CODES } from '../domain/opportunity-engine.model';
import { OPPORTUNITIES_REPOSITORY } from '../domain/opportunities.repository';
import type {
  LatestOpportunityRescanRecord,
  MaterializedOpportunityRecord,
  OpportunitiesRepository,
} from '../domain/opportunities.repository';
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
const SLOW_FEED_DEGRADATION_THRESHOLD_MS = 3_000;
const READ_PATH_DEGRADED_TTL_MS = 15 * 60 * 1000;
const MATERIALIZED_FEED_TTL_MS = 24 * 60 * 60 * 1000;

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

interface FeedEvaluationRecord {
  readonly itemVariantId: string;
  readonly evaluation: OpportunityEvaluationDto;
}

type OpportunityRejectStage =
  | 'missing_market_signal'
  | 'strict_variant_identity'
  | 'expired_source_state'
  | 'pre_score_outlier'
  | 'anti_fake'
  | 'post_pairability_execution'
  | 'post_pairability_threshold'
  | 'listed_exit_reference_only'
  | 'unknown';

interface EvaluationStageDetails {
  readonly primaryRejectStage?: OpportunityRejectStage;
  readonly pairReachedPairability: boolean;
  readonly blockedBeforePairability: boolean;
  readonly blockedAfterPairability: boolean;
  readonly nearMissCandidate: boolean;
}

@Injectable()
export class OpportunityFeedService {
  private readonly logger = new Logger(OpportunityFeedService.name);

  constructor(
    @Inject(OPPORTUNITIES_REPOSITORY)
    private readonly opportunitiesRepository: OpportunitiesRepository,
    @Inject(ScannerUniverseService)
    private readonly scannerUniverseService: ScannerUniverseService,
    @Inject(OpportunityEngineService)
    private readonly opportunityEngineService: OpportunityEngineService,
    @Inject(MarketFreshnessPolicyService)
    private readonly marketFreshnessPolicyService: MarketFreshnessPolicyService,
    @Inject(ReadPathDegradationService)
    private readonly readPathDegradationService: ReadPathDegradationService,
  ) {}

  async getPublicFeed(
    query: GetOpportunityFeedQueryDto = {},
  ): Promise<OpportunityPublicFeedPageDto> {
    const feed = await this.buildMaterializedFeed(query);

    return {
      pageInfo: feed.pageInfo,
      filters: feed.filters,
      summary: feed.summary,
      diagnostics: feed.diagnostics,
      items: feed.items.map((item) => this.toPublicFeedItem(item)),
    };
  }

  async getFullFeed(
    query: GetOpportunityFeedQueryDto = {},
  ): Promise<OpportunityFullFeedPageDto> {
    const feed = await this.buildMaterializedFeed(query);

    return {
      pageInfo: feed.pageInfo,
      filters: feed.filters,
      summary: feed.summary,
      diagnostics: feed.diagnostics,
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
      diagnostics: feed.diagnostics,
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
    readonly diagnostics: OpportunityFeedDiagnosticsDto;
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
      diagnostics: feed.diagnostics,
      items: feed.allItems.map((item) => this.toFullFeedItem(item)),
    };
  }

  async getOpportunityDetail(
    opportunityKey: string,
  ): Promise<OpportunityDetailDto> {
    const record = await this.resolveMaterializedOpportunityRecord(
      opportunityKey,
    );

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
    const { minProfit: _minProfit, minConfidence: _minConfidence, ...debugQuery } =
      query;

    const feed = await this.buildFeed(debugQuery, { includeRejected: true });
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

  private async buildMaterializedFeed(
    query: GetOpportunityFeedQueryDto,
  ): Promise<{
    readonly pageInfo: OpportunityPublicFeedPageDto['pageInfo'];
    readonly filters: OpportunityFeedFiltersDto;
    readonly summary: OpportunityFeedSummaryDto;
    readonly diagnostics: OpportunityFeedDiagnosticsDto;
    readonly items: readonly OpportunityFeedRecord[];
    readonly allItems: readonly OpportunityFeedRecord[];
  }> {
    const startedAt = Date.now();
    const now = new Date();
    const normalizedQuery = this.normalizeQuery(query);
    const materializedOpportunities =
      await this.opportunitiesRepository.listMaterializedOpportunities({
        now,
        detectedAfter: new Date(now.getTime() - MATERIALIZED_FEED_TTL_MS),
        ...(normalizedQuery.category
          ? { category: normalizedQuery.category }
          : {}),
        ...(normalizedQuery.sourcePair
          ? {
              sourcePair: {
                buySource: normalizedQuery.sourcePair.buySource,
                sellSource: normalizedQuery.sourcePair.sellSource,
              },
            }
          : {}),
        ...(normalizedQuery.minProfit !== undefined
          ? { minExpectedNet: normalizedQuery.minProfit }
          : {}),
        ...(normalizedQuery.minConfidence !== undefined
          ? { minConfidence: normalizedQuery.minConfidence }
          : {}),
      });
    const [scannerUniverseMap, latestRescan] = await Promise.all([
      this.scannerUniverseService.getScannerUniverseMap(
        materializedOpportunities.map((opportunity) => opportunity.itemVariantId),
      ),
      this.opportunitiesRepository.findLatestOpportunityRescan(),
    ]);
    const allFeedRecords = materializedOpportunities.flatMap((opportunity) => {
      const evaluation = this.toMaterializedEvaluation(opportunity);

      if (!evaluation) {
        return [];
      }

      if (!this.isMaterializedOpportunityUsable(opportunity, evaluation, now)) {
        return [];
      }

      const item =
        scannerUniverseMap.get(opportunity.itemVariantId) ??
        this.toFallbackScannerUniverseItem(opportunity);

      if (!this.matchesUniverseItem(item, normalizedQuery)) {
        return [];
      }

      return [this.toFeedRecord({ item, evaluation })];
    });
    const filteredRecords = allFeedRecords.filter((record) =>
      this.matchesEvaluation(record, normalizedQuery, false),
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
    const durationMs = Date.now() - startedAt;

    if (process.env.NODE_ENV !== 'test') {
      this.logger.log(
        `buildMaterializedFeed durationMs=${durationMs} page=${normalizedQuery.page} pageSize=${normalizedQuery.pageSize} materializedRows=${materializedOpportunities.length} returnedRows=${paginatedRecords.length} totalRows=${sortedRecords.length}`,
      );
    }

    return {
      pageInfo: {
        generatedAt: now,
        page: normalizedQuery.page,
        pageSize: normalizedQuery.pageSize,
        total: sortedRecords.length,
        totalPages: this.toTotalPages(
          sortedRecords.length,
          normalizedQuery.pageSize,
        ),
        evaluatedVariantCount: new Set(
          allFeedRecords.map((record) => record.item.itemVariantId),
        ).size,
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
      summary: this.createSummary(sortedRecords),
      diagnostics: this.buildMaterializedDiagnostics({
        latestRescan,
        materializedRowCount: materializedOpportunities.length,
        feedRecords: allFeedRecords,
        filteredRecords: sortedRecords,
      }),
      items: paginatedRecords,
      allItems: sortedRecords,
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
    readonly diagnostics: OpportunityFeedDiagnosticsDto;
    readonly items: readonly OpportunityFeedRecord[];
    readonly allItems: readonly OpportunityFeedRecord[];
  }> {
    const startedAt = Date.now();
    const normalizedQuery = this.normalizeQuery(query, options.scheme);

    try {
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
      const evaluationScan =
        await this.opportunityEngineService.evaluateVariants({
          itemVariantIds: filteredUniverseItems.map(
            (item) => item.itemVariantId,
          ),
          // Feed shaping always needs the full evaluated slice so diagnostics
          // can explain why rows were rejected before public filtering hides
          // them. Public/full/reject views still filter below.
          includeRejected: true,
          maxPairs: DEFAULT_FEED_MAX_PAIRS_PER_ITEM,
          allowHistoricalFallback: false,
          ...(options.scheme ? { scheme: options.scheme } : {}),
        });
      const evaluations = evaluationScan.results;
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
      const evaluationRecords = evaluations.flatMap((result) =>
        result.evaluations.map(
          (evaluation): FeedEvaluationRecord => ({
            itemVariantId: result.itemVariantId,
            evaluation,
          }),
        ),
      );
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
      const diagnostics = this.buildDiagnostics({
        scannedVariantCount: filteredUniverseItems.length,
        engineResults: evaluations,
        evaluationRecords,
        feedRecords,
        filteredRecords,
      });
      const durationMs = Date.now() - startedAt;

      if (process.env.NODE_ENV !== 'test') {
        this.logger.log(
          `buildFeed durationMs=${durationMs} includeRejected=${options.includeRejected} page=${normalizedQuery.page} pageSize=${normalizedQuery.pageSize} scannedVariants=${filteredUniverseItems.length} returnedRows=${paginatedRecords.length} totalRows=${sortedRecords.length}`,
        );
      }

      if (durationMs >= SLOW_FEED_DEGRADATION_THRESHOLD_MS) {
        await this.readPathDegradationService.trip({
          reason: 'opportunity_feed_slow',
          ttlMs: READ_PATH_DEGRADED_TTL_MS,
          details: {
            durationMs,
            includeRejected: options.includeRejected,
            page: normalizedQuery.page,
            pageSize: normalizedQuery.pageSize,
            scannedVariants: filteredUniverseItems.length,
            returnedRows: paginatedRecords.length,
            totalRows: sortedRecords.length,
          },
        });
      }

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
        diagnostics,
        items: paginatedRecords,
        allItems: sortedRecords,
      };
    } catch (error) {
      const durationMs = Date.now() - startedAt;

      if (durationMs >= SLOW_FEED_DEGRADATION_THRESHOLD_MS) {
        await this.readPathDegradationService.trip({
          reason: 'opportunity_feed_error',
          ttlMs: READ_PATH_DEGRADED_TTL_MS,
          details: {
            durationMs,
            includeRejected: options.includeRejected,
            page: normalizedQuery.page,
            pageSize: normalizedQuery.pageSize,
            error:
              error instanceof Error ? error.message : 'unknown_feed_error',
          },
        });
      }

      throw error;
    }
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
          allowHistoricalFallback: false,
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
      surfaceTier: record.evaluation.surfaceTier,
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
      ...(record.evaluation.eligibility.blockerReason
        ? { blockerReason: record.evaluation.eligibility.blockerReason }
        : {}),
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
      riskReasons: record.evaluation.riskReasons,
      componentScores: record.evaluation.componentScores,
      execution: record.evaluation.execution,
      strictTradable: record.evaluation.strictTradable,
      preScoreGate: record.evaluation.preScoreGate,
      eligibility: record.evaluation.eligibility,
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
    const stageDetails = this.describeEvaluationStage(record.evaluation);
    const prePairRejectReason = this.resolvePrePairRejectReason(record.evaluation);
    const postPairRejectReason = this.resolvePostPairRejectReason(record.evaluation);
    const missingMarketSignalRejected =
      this.resolvePrePairRejectReason(record.evaluation) === 'missing_market_signal';
    const strictVariantIdentityRejected =
      this.resolvePrePairRejectReason(record.evaluation) === 'strict_variant_identity';
    const strictIdentityDetails = strictVariantIdentityRejected
      ? this.describeStrictIdentityMismatch(record.evaluation)
      : undefined;
    const staleRejected =
      this.resolvePrePairRejectReason(record.evaluation) === 'expired_source_state';

    return {
      ...this.toFullFeedItem(record),
      reasonCodes: record.evaluation.reasonCodes,
      penalties: record.evaluation.penalties,
      antiFakeAssessment: record.evaluation.antiFakeAssessment,
      primaryRejectStage: stageDetails.primaryRejectStage ?? 'unknown',
      blockerClass: this.resolveRejectBlockerClass({
        prePairRejectReason,
        postPairRejectReason,
      }),
      ...(prePairRejectReason ? { prePairRejectReason } : {}),
      ...(postPairRejectReason ? { postPairRejectReason } : {}),
      overlapExisted: true,
      pairReachedPairability: stageDetails.pairReachedPairability,
      blockedBeforePairability: stageDetails.blockedBeforePairability,
      blockedAfterPairability: stageDetails.blockedAfterPairability,
      listedExitOnly: record.evaluation.pairability.listedExitOnly,
      blockedButPresentCandidate:
        !record.evaluation.reasonCodes.includes('buy_source_has_no_ask') &&
        !record.evaluation.reasonCodes.includes('sell_source_has_no_exit_signal'),
      strictVariantIdentityRejected,
      ...(strictIdentityDetails ? { strictIdentityDetails } : {}),
      staleRejected,
      missingMarketSignalRejected,
      failedOnlyBecauseListedExit:
        stageDetails.primaryRejectStage === 'listed_exit_reference_only',
      failedOnlyBecauseStale:
        staleRejected &&
        !strictVariantIdentityRejected &&
        !missingMarketSignalRejected,
      failedOnlyBecauseStrictVariantKey:
        strictVariantIdentityRejected &&
        !staleRejected &&
        !missingMarketSignalRejected,
    };
  }

  private createSummary(
    items: readonly OpportunityFeedRecord[],
  ): OpportunityFeedSummaryDto {
    let candidate = 0;
    let nearEligible = 0;
    let eligible = 0;
    let riskyHighUpside = 0;
    let tradable = 0;
    let referenceBacked = 0;
    let nearEligibleTier = 0;
    let research = 0;

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

      switch (item.evaluation.surfaceTier) {
        case 'tradable':
          tradable += 1;
          break;
        case 'reference_backed':
          referenceBacked += 1;
          break;
        case 'near_eligible':
          nearEligibleTier += 1;
          break;
        case 'research':
          research += 1;
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
      tradable,
      referenceBacked,
      nearEligibleTier,
      research,
    };
  }

  private buildPipelineDiagnostics(input: {
    readonly emptyUniverseCount: number;
    readonly zeroOverlapCount: number;
    readonly prePairabilityEliminatedCount: number;
    readonly materializationNotRunCount: number;
    readonly materializedRowsFilteredOutCount: number;
    readonly softListedExitOnlyCount: number;
    readonly nearEqualAfterFeesCount: number;
    readonly trueNonPositiveEdgeCount: number;
  }): readonly import('../dto/opportunity-feed.dto').OpportunityFeedDiagnosticCountDto[] {
    return [
      { key: 'empty_universe', count: input.emptyUniverseCount },
      { key: 'zero_overlap', count: input.zeroOverlapCount },
      {
        key: 'pre_pairability_eliminated',
        count: input.prePairabilityEliminatedCount,
      },
      {
        key: 'materialization_not_run',
        count: input.materializationNotRunCount,
      },
      {
        key: 'materialized_rows_filtered_out',
        count: input.materializedRowsFilteredOutCount,
      },
      {
        key: 'soft_listed_exit_only',
        count: input.softListedExitOnlyCount,
      },
      {
        key: 'near_equal_after_fees',
        count: input.nearEqualAfterFeesCount,
      },
      {
        key: 'true_non_positive_edge',
        count: input.trueNonPositiveEdgeCount,
      },
    ];
  }

  private buildDiagnostics(input: {
    readonly scannedVariantCount: number;
    readonly engineResults: readonly import('../dto/opportunity-engine.dto').OpportunityEngineVariantResultDto[];
    readonly evaluationRecords: readonly FeedEvaluationRecord[];
    readonly feedRecords: readonly OpportunityFeedRecord[];
    readonly filteredRecords: readonly OpportunityFeedRecord[];
  }): OpportunityFeedDiagnosticsDto {
    const stagedEvaluationRecords = input.evaluationRecords.map((record) => ({
      ...record,
      stageDetails: this.describeEvaluationStage(record.evaluation),
    }));
    const variantsWithCounterSourceCandidate = input.engineResults.filter(
      (result) => result.evaluatedPairCount > 0,
    ).length;
    const variantsRejectedForLowOverlapOrLowPairability =
      input.engineResults.filter(
        (result) => result.evaluatedPairCount > 0 && result.diagnostics.pairable === 0,
      ).length;
    const nonRejectedFeedRecordCount = input.feedRecords.filter(
      (record) => record.evaluation.disposition !== 'rejected',
    ).length;
    const filteredNonRejectedRecords = input.filteredRecords.filter(
      (record) => record.evaluation.disposition !== 'rejected',
    );
    const rejectedEvaluations = stagedEvaluationRecords.filter(
      (record) => record.evaluation.disposition === 'rejected',
    );
    const blockedButPresentCount = rejectedEvaluations.filter((record) => {
      const reasonCodes = new Set(record.evaluation.reasonCodes);

      return (
        !reasonCodes.has('buy_source_has_no_ask') &&
        !reasonCodes.has('sell_source_has_no_exit_signal')
      );
    }).length;
    const lowConfidenceCandidateCount = filteredNonRejectedRecords.filter(
      (record) =>
        record.evaluation.disposition === 'candidate' &&
        record.evaluation.finalConfidence < 0.62,
    ).length;
    const pairableCount = stagedEvaluationRecords.filter(
      (record) => record.evaluation.pairability.status === 'pairable',
    ).length;
    const blockedBeforePairabilityCount = rejectedEvaluations.filter(
      (record) => record.stageDetails.blockedBeforePairability,
    ).length;
    const blockedAfterPairabilityCount = rejectedEvaluations.filter(
      (record) => record.stageDetails.blockedAfterPairability,
    ).length;
    const nearMissCandidateCount = filteredNonRejectedRecords.filter(
      (record) => !record.evaluation.eligibility.eligible,
    ).length;
    const eligibleCount = filteredNonRejectedRecords.filter(
      (record) => record.evaluation.eligibility.eligible,
    ).length;
    const listedExitOnlyCount = stagedEvaluationRecords.filter(
      (record) => record.evaluation.pairability.status === 'listed_exit_only',
    ).length;
    const softListedExitOnlyCount = stagedEvaluationRecords.filter(
      (record) =>
        record.evaluation.pairability.status === 'listed_exit_only' &&
        record.evaluation.disposition !== 'rejected',
    ).length;
    const strictVariantIdentityRejectCount = rejectedEvaluations.filter((record) =>
      this.hasAnyReason(record.evaluation.reasonCodes, [
        'strict_variant_key_missing',
        'strict_variant_key_mismatch',
      ]),
    ).length;
    const staleRejectCount = rejectedEvaluations.filter(
      (record) => record.evaluation.preScoreGate.rejectedByStale,
    ).length;
    const missingMarketSignalRejectCount = rejectedEvaluations.filter((record) =>
      this.hasAnyReason(record.evaluation.reasonCodes, [
        'buy_source_has_no_ask',
        'sell_source_has_no_exit_signal',
      ]),
    ).length;
    const buySourceHasNoAskRejectCount = rejectedEvaluations.filter((record) =>
      record.evaluation.reasonCodes.includes('buy_source_has_no_ask'),
    ).length;
    const sellSourceHasNoExitSignalRejectCount = rejectedEvaluations.filter(
      (record) =>
        record.evaluation.reasonCodes.includes('sell_source_has_no_exit_signal'),
    ).length;
    const averageExecutionNetAfterFees = filteredNonRejectedRecords.length
      ? Number(
          (
            filteredNonRejectedRecords.reduce(
              (total, record) => total + record.evaluation.execution.expectedNet,
              0,
            ) / filteredNonRejectedRecords.length
          ).toFixed(4),
        )
      : undefined;
    const sourceCoverageImbalance = this.buildSourceCoverageImbalance(
      input.evaluationRecords,
    );
    const nearEqualAfterFeesCount = stagedEvaluationRecords.filter((record) =>
      record.evaluation.reasonCodes.includes('near_equal_after_fees'),
    ).length;
    const trueNonPositiveEdgeCount = rejectedEvaluations.filter((record) =>
      record.evaluation.reasonCodes.includes('true_non_positive_edge'),
    ).length;

    return {
      scannedVariantCount: input.scannedVariantCount,
      variantsWithCounterSourceCandidate,
      noPairablePairCount: variantsRejectedForLowOverlapOrLowPairability,
      evaluatedPairCount: input.engineResults.reduce(
        (total, result) => total + result.evaluatedPairCount,
        0,
      ),
      pairableCount,
      blockedBeforePairabilityCount,
      blockedAfterPairabilityCount,
      nearMissCandidateCount,
      eligibleCount,
      visibleFeedCount: filteredNonRejectedRecords.length,
      validOpportunityCount: filteredNonRejectedRecords.length,
      feedEligibleCount: eligibleCount,
      blockedButPresentCount,
      listedExitOnlyCount,
      strictVariantIdentityRejectCount,
      staleRejectCount,
      missingMarketSignalRejectCount,
      buySourceHasNoAskRejectCount,
      sellSourceHasNoExitSignalRejectCount,
      lowConfidenceCandidateCount,
      hiddenByFeedQueryFilters: Math.max(
        0,
        nonRejectedFeedRecordCount - filteredNonRejectedRecords.length,
      ),
      ...(averageExecutionNetAfterFees !== undefined
        ? { averageExecutionNetAfterFees }
        : {}),
      ...(sourceCoverageImbalance ? { sourceCoverageImbalance } : {}),
      pipelineDiagnostics: this.buildPipelineDiagnostics({
        emptyUniverseCount: input.scannedVariantCount === 0 ? 1 : 0,
        zeroOverlapCount: Math.max(
          0,
          input.scannedVariantCount - variantsWithCounterSourceCandidate,
        ),
        prePairabilityEliminatedCount: blockedBeforePairabilityCount,
        materializationNotRunCount: 0,
        materializedRowsFilteredOutCount: 0,
        softListedExitOnlyCount,
        nearEqualAfterFeesCount,
        trueNonPositiveEdgeCount,
      }),
      overlapBySourcePair: this.buildSourcePairDiagnostics(
        stagedEvaluationRecords,
        input.filteredRecords,
      ),
      rejectionSummary: this.buildRejectionSummary({
        scannedVariantCount: input.scannedVariantCount,
        variantsWithCounterSourceCandidate,
        variantsRejectedForLowOverlapOrLowPairability,
        rejectedEvaluations,
      }),
    };
  }

  private buildMaterializedDiagnostics(input: {
    readonly latestRescan: LatestOpportunityRescanRecord | null;
    readonly materializedRowCount: number;
    readonly feedRecords: readonly OpportunityFeedRecord[];
    readonly filteredRecords: readonly OpportunityFeedRecord[];
  }): OpportunityFeedDiagnosticsDto {
    const evaluationRecords = input.feedRecords.map(
      (record): FeedEvaluationRecord => ({
        itemVariantId: record.item.itemVariantId,
        evaluation: record.evaluation,
      }),
    );
    const filteredNonRejectedRecords = input.filteredRecords.filter(
      (record) => record.evaluation.disposition !== 'rejected',
    );
    const latestRescan = this.readLatestRescanMetrics(input.latestRescan?.result);
    const scannedVariantCount =
      latestRescan?.scannedVariantCount ??
      new Set(input.feedRecords.map((record) => record.item.itemVariantId)).size;
    const variantsWithCounterSourceCandidate =
      latestRescan?.variantFunnel.withEvaluatedPairs ??
      new Set(input.feedRecords.map((record) => record.item.itemVariantId)).size;
    const visibleFeedCount = filteredNonRejectedRecords.length;
    const eligibleCount = filteredNonRejectedRecords.filter(
      (record) => record.evaluation.eligibility.eligible,
    ).length;
    const nearMissCandidateCount = filteredNonRejectedRecords.filter(
      (record) => !record.evaluation.eligibility.eligible,
    ).length;
    const lowConfidenceCandidateCount = filteredNonRejectedRecords.filter(
      (record) =>
        record.evaluation.disposition === 'candidate' &&
        record.evaluation.finalConfidence < 0.62,
    ).length;
    const averageExecutionNetAfterFees = filteredNonRejectedRecords.length
      ? Number(
          (
            filteredNonRejectedRecords.reduce(
              (total, record) => total + record.evaluation.execution.expectedNet,
              0,
            ) / filteredNonRejectedRecords.length
          ).toFixed(4),
        )
      : undefined;
    const sourceCoverageImbalance = this.buildSourceCoverageImbalance(
      evaluationRecords,
    );
    const strictVariantIdentityRejectCount =
      (latestRescan?.pairFunnel.strictVariantKeyMissing ?? 0) +
      (latestRescan?.pairFunnel.strictVariantKeyMismatch ?? 0);
    const variantsRejectedForLowOverlapOrLowPairability = Math.max(
      0,
      (latestRescan?.variantFunnel.withEvaluatedPairs ?? 0) -
        (latestRescan?.variantFunnel.withPairablePairs ?? 0),
    );
    const hiddenByFeedQueryFilters = Math.max(
      0,
      input.feedRecords.length - filteredNonRejectedRecords.length,
    );
    const materializedRowsFilteredOutCount = Math.max(
      0,
      input.materializedRowCount - filteredNonRejectedRecords.length,
    );
    const softListedExitOnlyCount =
      latestRescan?.pairFunnel.softListedExitOnly ??
      input.feedRecords.filter(
        (record) =>
          record.evaluation.pairability.status === 'listed_exit_only' &&
          record.evaluation.disposition !== 'rejected',
      ).length;
    const nearEqualAfterFeesCount =
      latestRescan?.pairFunnel.nearEqualAfterFees ??
      input.feedRecords.filter((record) =>
        record.evaluation.reasonCodes.includes('near_equal_after_fees'),
      ).length;
    const trueNonPositiveEdgeCount =
      latestRescan?.pairFunnel.trueNonPositiveEdge ?? 0;

    return {
      scannedVariantCount,
      variantsWithCounterSourceCandidate,
      noPairablePairCount: variantsRejectedForLowOverlapOrLowPairability,
      evaluatedPairCount:
        latestRescan?.pairFunnel.evaluated ?? input.feedRecords.length,
      pairableCount:
        latestRescan?.pairFunnel.pairable ??
        input.feedRecords.filter(
          (record) => record.evaluation.pairability.status === 'pairable',
        ).length,
      blockedBeforePairabilityCount:
        (latestRescan?.pairFunnel.buySourceHasNoAsk ?? 0) +
        (latestRescan?.pairFunnel.sellSourceHasNoExitSignal ?? 0) +
        (latestRescan?.pairFunnel.preScoreRejected ?? 0) +
        strictVariantIdentityRejectCount,
      blockedAfterPairabilityCount: latestRescan?.pairFunnel.blocked ?? 0,
      nearMissCandidateCount,
      eligibleCount,
      visibleFeedCount,
      validOpportunityCount: visibleFeedCount,
      feedEligibleCount: eligibleCount,
      blockedButPresentCount: latestRescan?.pairFunnel.blocked ?? 0,
      listedExitOnlyCount:
        latestRescan?.pairFunnel.listedExitOnly ??
        input.feedRecords.filter(
          (record) =>
            record.evaluation.pairability.status === 'listed_exit_only',
        ).length,
      strictVariantIdentityRejectCount,
      staleRejectCount: latestRescan?.pairFunnel.preScoreRejected ?? 0,
      missingMarketSignalRejectCount:
        (latestRescan?.pairFunnel.buySourceHasNoAsk ?? 0) +
        (latestRescan?.pairFunnel.sellSourceHasNoExitSignal ?? 0),
      buySourceHasNoAskRejectCount:
        latestRescan?.pairFunnel.buySourceHasNoAsk ?? 0,
      sellSourceHasNoExitSignalRejectCount:
        latestRescan?.pairFunnel.sellSourceHasNoExitSignal ?? 0,
      lowConfidenceCandidateCount,
      hiddenByFeedQueryFilters,
      ...(averageExecutionNetAfterFees !== undefined
        ? { averageExecutionNetAfterFees }
        : {}),
      ...(sourceCoverageImbalance ? { sourceCoverageImbalance } : {}),
      pipelineDiagnostics: this.buildPipelineDiagnostics({
        emptyUniverseCount:
          latestRescan?.scannedVariantCount === 0 ? 1 : 0,
        zeroOverlapCount: Math.max(
          0,
          scannedVariantCount - variantsWithCounterSourceCandidate,
        ),
        prePairabilityEliminatedCount:
          (latestRescan?.pairFunnel.buySourceHasNoAsk ?? 0) +
          (latestRescan?.pairFunnel.sellSourceHasNoExitSignal ?? 0) +
          (latestRescan?.pairFunnel.preScoreRejected ?? 0) +
          strictVariantIdentityRejectCount,
        materializationNotRunCount:
          latestRescan || input.materializedRowCount > 0 ? 0 : 1,
        materializedRowsFilteredOutCount,
        softListedExitOnlyCount,
        nearEqualAfterFeesCount,
        trueNonPositiveEdgeCount,
      }),
      overlapBySourcePair: this.buildSourcePairDiagnostics(
        evaluationRecords.map((record) => ({
          ...record,
          stageDetails: this.describeEvaluationStage(record.evaluation),
        })),
        input.filteredRecords,
      ),
      rejectionSummary: {
        variantsRejectedForMissingCounterSource: Math.max(
          0,
          scannedVariantCount - variantsWithCounterSourceCandidate,
        ),
        variantsRejectedForLowOverlapOrLowPairability:
          variantsRejectedForLowOverlapOrLowPairability,
        pairsRejectedForCanonicalOrVariantMismatch:
          strictVariantIdentityRejectCount,
        pairsRejectedForFeesOrExecutionNet:
          latestRescan?.pairFunnel.trueNonPositiveEdge ??
          latestRescan?.pairFunnel.negativeExpectedNet ??
          0,
        pairsRejectedForMinProfit: 0,
        pairsRejectedForConfidenceThreshold:
          latestRescan?.pairFunnel.confidenceBelowCandidateFloor ?? 0,
        pairsRejectedForBlockerOrRiskRules: latestRescan?.pairFunnel.blocked ?? 0,
        pairsRejectedForFreshnessOrLiquidity:
          latestRescan?.pairFunnel.preScoreRejected ?? 0,
        primaryRejectStages: [],
        blockerCountsByReason: this.readDiagnosticCounts(
          latestRescan?.topBlockerReasons,
          'blockerReason',
        ),
        topRejectReasons: this.readDiagnosticCounts(
          latestRescan?.topRejectReasons,
          'reasonCode',
        ),
        topBlockerReasons: this.readDiagnosticCounts(
          latestRescan?.topBlockerReasons,
          'blockerReason',
        ),
      },
    };
  }

  private async resolveMaterializedOpportunityRecord(
    opportunityKey: string,
  ): Promise<OpportunityFeedRecord | null> {
    const parts = parseOpportunityKey(opportunityKey);

    if (!parts) {
      throw new BadRequestException(
        `Invalid opportunityKey '${opportunityKey}'.`,
      );
    }

    const now = new Date();
    const opportunity =
      await this.opportunitiesRepository.findLatestMaterializedOpportunity({
        now,
        detectedAfter: new Date(now.getTime() - MATERIALIZED_FEED_TTL_MS),
        itemVariantId: parts.itemVariantId,
        sourcePair: {
          buySource: parts.buySource,
          sellSource: parts.sellSource,
        },
      });

    if (!opportunity) {
      return null;
    }

    const evaluation = this.toMaterializedEvaluation(opportunity);

    if (
      !evaluation ||
      !this.isMaterializedOpportunityUsable(opportunity, evaluation, now)
    ) {
      return null;
    }

    const item =
      (await this.scannerUniverseService.getScannerUniverseMap([
        opportunity.itemVariantId,
      ])).get(opportunity.itemVariantId) ??
      this.toFallbackScannerUniverseItem(opportunity);

    return this.toFeedRecord({
      item,
      evaluation,
    });
  }

  private toMaterializedEvaluation(
    opportunity: MaterializedOpportunityRecord,
  ): OpportunityEvaluationDto | null {
    const notes = this.readJsonObject(opportunity.notes);
    const reasonCodes = this.readStringArray(notes.reasonCodes).filter((value) =>
      this.isOpportunityReasonCode(value),
    ) as OpportunityReasonCode[];
    const penalties = this.readPenaltyBreakdown(notes.penalties);
    const buy = this.readMaterializedSourceLeg({
      source: opportunity.buySource.code,
      sourceName: opportunity.buySource.name,
      snapshotId: opportunity.buySnapshotId,
      notes: this.readJsonObject(notes.buy),
    });
    const sell = this.readMaterializedSourceLeg({
      source: opportunity.sellSource.code,
      sourceName: opportunity.sellSource.name,
      snapshotId: opportunity.sellSnapshotId,
      notes: this.readJsonObject(notes.sell),
    });

    if (!buy || !sell) {
      return null;
    }

    const eligibility = this.readEligibility(notes.eligibility);
    const expectedNetProfit = this.toDecimalNumber(opportunity.expectedNet);
    const rawSpread =
      this.readNumber(notes.rawSpread) ??
      this.toDecimalNumber(opportunity.spreadAbsolute);
    const rawSpreadPercent =
      this.readNumber(notes.rawSpreadPercent) ??
      this.toDecimalNumber(opportunity.spreadPercent);

    return {
      opportunityKey: ['opp', opportunity.itemVariantId, buy.source, sell.source].join(
        '_',
      ),
      disposition:
        this.readEvaluationDisposition(notes.disposition) ??
        (eligibility.eligible ? 'eligible' : 'candidate'),
      surfaceTier:
        this.readSurfaceTier(notes.surfaceTier) ??
        (eligibility.eligible ? 'tradable' : 'research'),
      reasonCodes,
      riskClass: this.toRiskClass(opportunity.riskClass),
      riskReasons: this.readRiskReasons(notes.riskReasons),
      category: opportunity.category,
      canonicalItemId: opportunity.canonicalItemId,
      canonicalDisplayName:
        this.readString(notes.canonicalDisplayName) ??
        opportunity.canonicalItemDisplayName,
      itemVariantId: opportunity.itemVariantId,
      variantDisplayName:
        this.readString(notes.variantDisplayName) ??
        opportunity.itemVariantDisplayName,
      sourcePairKey:
        this.readString(notes.sourcePairKey) ??
        `${buy.source}->${sell.source}`,
      buy,
      sell,
      rawSpread,
      rawSpreadPercent,
      feesAdjustedSpread:
        this.readNumber(notes.feesAdjustedSpread) ?? expectedNetProfit,
      expectedNetProfit,
      expectedExitPrice:
        this.readNumber(notes.expectedExitPrice) ?? sell.bid ?? sell.ask ?? 0,
      estimatedSellFeeRate: this.readNumber(notes.estimatedSellFeeRate) ?? 0,
      buyCost: this.readNumber(notes.buyCost) ?? buy.ask ?? 0,
      sellSignalPrice:
        this.readNumber(notes.sellSignalPrice) ?? sell.bid ?? sell.ask ?? 0,
      componentScores: this.readComponentScores(notes.componentScores),
      execution: this.readExecution(notes.execution, expectedNetProfit),
      finalConfidence: this.toDecimalNumber(opportunity.confidence),
      penalties,
      antiFakeAssessment: this.readAntiFakeAssessment(notes.antiFakeAssessment),
      strictTradable: this.readStrictTradable(notes.strictTradable),
      preScoreGate: this.readPreScoreGate(notes.preScoreGate, reasonCodes),
      eligibility,
      validation: this.readValidation(notes.validation, reasonCodes),
      pairability: this.readPairability(notes.pairability, sell, reasonCodes),
      explainability: {
        reasonCodes,
        penalties,
      },
      rankingInputs: this.readRankingInputs(notes.rankingInputs),
      ...(this.readBackupConfirmation(notes.backupConfirmation)
        ? {
            backupConfirmation: this.readBackupConfirmation(
              notes.backupConfirmation,
            )!,
          }
        : {}),
    };
  }

  private isMaterializedOpportunityUsable(
    opportunity: MaterializedOpportunityRecord,
    evaluation: OpportunityEvaluationDto,
    now: Date,
  ): boolean {
    if (opportunity.expiresAt && opportunity.expiresAt <= now) {
      return false;
    }

    const buyFreshness = this.marketFreshnessPolicyService.evaluateSourceState(
      {
        sourceCode: opportunity.buySource.code,
        sourceKind: opportunity.buySource.kind,
        sourceMetadata: opportunity.buySource.metadata,
      },
      evaluation.buy.observedAt,
      now,
    );
    const sellFreshness = this.marketFreshnessPolicyService.evaluateSourceState(
      {
        sourceCode: opportunity.sellSource.code,
        sourceKind: opportunity.sellSource.kind,
        sourceMetadata: opportunity.sellSource.metadata,
      },
      evaluation.sell.observedAt,
      now,
    );

    return buyFreshness.usable && sellFreshness.usable;
  }

  private toFallbackScannerUniverseItem(
    opportunity: MaterializedOpportunityRecord,
  ): ScannerUniverseItemDto {
    const uniqueSourceCount = new Set([
      opportunity.buySource.code,
      opportunity.sellSource.code,
    ]).size;

    return {
      canonicalItemId: opportunity.canonicalItemId,
      canonicalDisplayName: opportunity.canonicalItemDisplayName,
      itemVariantId: opportunity.itemVariantId,
      variantDisplayName: opportunity.itemVariantDisplayName,
      category: opportunity.category,
      itemType: this.normalizeItemType(
        opportunity.canonicalItemWeaponName ?? opportunity.category.toLowerCase(),
      ),
      tier: 'cold',
      compositeScore: 0,
      signals: {
        liquidity: 0,
        priceMovement: 0,
        sourceActivity: 0,
        pairability: 0,
        composite: 0,
      },
      pairabilityMetrics: {
        currentReadyPairCount: uniqueSourceCount >= 2 ? 1 : 0,
        usablePrimarySourceCount: uniqueSourceCount,
        freshPrimarySourceCount: uniqueSourceCount,
      },
      sourceMetrics: {
        totalSourceCount: uniqueSourceCount,
        usableSourceCount: uniqueSourceCount,
        freshSourceCount: uniqueSourceCount,
        backupSourceCount: 0,
      },
      pollingPlan: [],
      promotionReasons: [],
      demotionReasons: ['materialized_feed_scanner_fallback'],
    };
  }

  private buildSourcePairDiagnostics(
    evaluationRecords: readonly (FeedEvaluationRecord & {
      readonly stageDetails: EvaluationStageDetails;
    })[],
    filteredRecords: readonly OpportunityFeedRecord[],
  ): readonly import('../dto/opportunity-feed.dto').OpportunityFeedSourcePairDiagnosticDto[] {
    const overlapBySourcePair = new Map<string, Set<string>>();
    const directionalCountsBySourcePair = new Map<
      string,
      {
        directionalEvaluationCount: number;
        directionalBuyAskCount: number;
        directionalSellExitCount: number;
        directionalFirmExitCount: number;
        directionalListedExitOnlyCount: number;
        directionalMissingSignalCount: number;
      }
    >();
    const pairableBySourcePair = new Map<string, Set<string>>();
    const blockedBeforeBySourcePair = new Map<string, Set<string>>();
    const blockedAfterBySourcePair = new Map<string, Set<string>>();
    const nearMissBySourcePair = new Map<string, Set<string>>();
    const eligibleBySourcePair = new Map<string, Set<string>>();
    const visibleBySourcePair = new Map<string, Set<string>>();
    const blockersBySourcePair = new Map<
      string,
      Map<string, number>
    >();

    for (const record of evaluationRecords) {
      const overlapSet =
        overlapBySourcePair.get(record.evaluation.sourcePairKey) ?? new Set<string>();

      overlapSet.add(record.itemVariantId);
      overlapBySourcePair.set(record.evaluation.sourcePairKey, overlapSet);
      const directionalCounts =
        directionalCountsBySourcePair.get(record.evaluation.sourcePairKey) ?? {
          directionalEvaluationCount: 0,
          directionalBuyAskCount: 0,
          directionalSellExitCount: 0,
          directionalFirmExitCount: 0,
          directionalListedExitOnlyCount: 0,
          directionalMissingSignalCount: 0,
        };

      directionalCounts.directionalEvaluationCount += 1;
      if (record.evaluation.buy.ask !== undefined) {
        directionalCounts.directionalBuyAskCount += 1;
      }
      if (
        record.evaluation.sell.bid !== undefined ||
        record.evaluation.sell.ask !== undefined
      ) {
        directionalCounts.directionalSellExitCount += 1;
      }
      if (record.evaluation.sell.bid !== undefined) {
        directionalCounts.directionalFirmExitCount += 1;
      }
      if (record.evaluation.pairability.status === 'listed_exit_only') {
        directionalCounts.directionalListedExitOnlyCount += 1;
      }
      if (
        record.evaluation.reasonCodes.includes('buy_source_has_no_ask') ||
        record.evaluation.reasonCodes.includes('sell_source_has_no_exit_signal')
      ) {
        directionalCounts.directionalMissingSignalCount += 1;
      }
      directionalCountsBySourcePair.set(
        record.evaluation.sourcePairKey,
        directionalCounts,
      );

      if (record.evaluation.pairability.status === 'pairable') {
        const pairableSet =
          pairableBySourcePair.get(record.evaluation.sourcePairKey) ??
          new Set<string>();

        pairableSet.add(record.itemVariantId);
        pairableBySourcePair.set(record.evaluation.sourcePairKey, pairableSet);
      }

      if (record.stageDetails.blockedBeforePairability) {
        const blockedBeforeSet =
          blockedBeforeBySourcePair.get(record.evaluation.sourcePairKey) ??
          new Set<string>();

        blockedBeforeSet.add(record.itemVariantId);
        blockedBeforeBySourcePair.set(
          record.evaluation.sourcePairKey,
          blockedBeforeSet,
        );
      }

      if (record.stageDetails.blockedAfterPairability) {
        const blockedAfterSet =
          blockedAfterBySourcePair.get(record.evaluation.sourcePairKey) ??
          new Set<string>();

        blockedAfterSet.add(record.itemVariantId);
        blockedAfterBySourcePair.set(
          record.evaluation.sourcePairKey,
          blockedAfterSet,
        );
      }

      if (
        record.evaluation.disposition !== 'rejected' &&
        !record.evaluation.eligibility.eligible
      ) {
        const nearMissSet =
          nearMissBySourcePair.get(record.evaluation.sourcePairKey) ??
          new Set<string>();

        nearMissSet.add(record.itemVariantId);
        nearMissBySourcePair.set(record.evaluation.sourcePairKey, nearMissSet);
      }

      if (record.evaluation.eligibility.eligible) {
        const eligibleSet =
          eligibleBySourcePair.get(record.evaluation.sourcePairKey) ??
          new Set<string>();

        eligibleSet.add(record.itemVariantId);
        eligibleBySourcePair.set(record.evaluation.sourcePairKey, eligibleSet);
      }

      const blockerKey = this.resolveDiagnosticBlockerKey(record.evaluation);

      if (blockerKey) {
        const blockerCounts =
          blockersBySourcePair.get(record.evaluation.sourcePairKey) ??
          new Map<string, number>();

        blockerCounts.set(blockerKey, (blockerCounts.get(blockerKey) ?? 0) + 1);
        blockersBySourcePair.set(record.evaluation.sourcePairKey, blockerCounts);
      }
    }

    for (const record of filteredRecords) {
      if (record.evaluation.disposition === 'rejected') {
        continue;
      }

      const visibleSet =
        visibleBySourcePair.get(record.evaluation.sourcePairKey) ??
        new Set<string>();

      visibleSet.add(record.item.itemVariantId);
      visibleBySourcePair.set(record.evaluation.sourcePairKey, visibleSet);
    }

    return [...overlapBySourcePair.entries()]
      .map(([sourcePairKey, overlapSet]) => {
        const directionalCounts =
          directionalCountsBySourcePair.get(sourcePairKey) ?? {
            directionalEvaluationCount: 0,
            directionalBuyAskCount: 0,
            directionalSellExitCount: 0,
            directionalFirmExitCount: 0,
            directionalListedExitOnlyCount: 0,
            directionalMissingSignalCount: 0,
          };

        return {
          sourcePairKey,
          overlapCount: overlapSet.size,
          ...directionalCounts,
          pairableVariantCount:
            pairableBySourcePair.get(sourcePairKey)?.size ?? 0,
          blockedBeforePairabilityCount:
            blockedBeforeBySourcePair.get(sourcePairKey)?.size ?? 0,
          blockedAfterPairabilityCount:
            blockedAfterBySourcePair.get(sourcePairKey)?.size ?? 0,
          nearMissCandidateCount:
            nearMissBySourcePair.get(sourcePairKey)?.size ?? 0,
          eligibleCount: eligibleBySourcePair.get(sourcePairKey)?.size ?? 0,
          visibleFeedCount: visibleBySourcePair.get(sourcePairKey)?.size ?? 0,
          topBlockers: [
            ...(blockersBySourcePair.get(sourcePairKey) ??
              new Map<string, number>()).entries(),
          ]
            .map(([key, count]) => ({ key, count }))
            .sort((left, right) => {
              if (right.count !== left.count) {
                return right.count - left.count;
              }

              return left.key.localeCompare(right.key);
            })
            .slice(0, 4),
        };
      })
      .sort((left, right) => {
        if (right.overlapCount !== left.overlapCount) {
          return right.overlapCount - left.overlapCount;
        }

        return left.sourcePairKey.localeCompare(right.sourcePairKey);
      });
  }

  private buildSourceCoverageImbalance(
    evaluationRecords: readonly FeedEvaluationRecord[],
  ): OpportunityFeedDiagnosticsDto['sourceCoverageImbalance'] | undefined {
    const coverageBySource = new Map<SourceAdapterKey, Set<string>>();

    for (const record of evaluationRecords) {
      for (const source of [
        record.evaluation.buy.source,
        record.evaluation.sell.source,
      ] satisfies readonly SourceAdapterKey[]) {
        const variants = coverageBySource.get(source) ?? new Set<string>();

        variants.add(record.itemVariantId);
        coverageBySource.set(source, variants);
      }
    }

    const coverageEntries = [...coverageBySource.entries()]
      .map(([source, itemVariantIds]) => ({
        source,
        count: itemVariantIds.size,
      }))
      .filter((entry) => entry.count > 0)
      .sort((left, right) => right.count - left.count);

    if (coverageEntries.length < 2) {
      return undefined;
    }

    const dominant = coverageEntries[0]!;
    const bottleneck = coverageEntries[coverageEntries.length - 1]!;

    return {
      dominantSource: dominant.source,
      dominantCoverageCount: dominant.count,
      bottleneckSource: bottleneck.source,
      bottleneckCoverageCount: bottleneck.count,
      coverageRatio: Number(
        (dominant.count / Math.max(1, bottleneck.count)).toFixed(2),
      ),
    };
  }

  private buildRejectionSummary(input: {
    readonly scannedVariantCount: number;
    readonly variantsWithCounterSourceCandidate: number;
    readonly variantsRejectedForLowOverlapOrLowPairability: number;
    readonly rejectedEvaluations: readonly (FeedEvaluationRecord & {
      readonly stageDetails: EvaluationStageDetails;
    })[];
  }): OpportunityFeedDiagnosticsDto['rejectionSummary'] {
    const mismatchReasons = new Set<OpportunityReasonCode>([
      'strict_variant_key_missing',
      'strict_variant_key_mismatch',
    ]);
    const feeExecutionReasons = new Set<OpportunityReasonCode>([
      'negative_fees_adjusted_spread',
      'non_positive_raw_spread',
      'true_non_positive_edge',
    ]);
    const minProfitReasons = new Set<OpportunityReasonCode>([
      'expected_net_below_category_floor',
      'spread_percent_below_category_floor',
    ]);
    const confidenceReasons = new Set<OpportunityReasonCode>([
      'confidence_below_candidate_floor',
      'confidence_below_eligible_floor',
    ]);
    const freshnessLiquidityReasons = new Set<OpportunityReasonCode>([
      'stale_pre_score_rejection',
      'freshness_penalty_elevated',
      'liquidity_penalty_elevated',
      'stale_penalty_elevated',
      'STALE_SOURCE_STATE',
      'INSUFFICIENT_LIQUIDITY',
      'FROZEN_MARKET',
    ]);
    const blockerRiskReasons = new Set<OpportunityReasonCode>([
      'pre_score_outlier_rejected',
      'source_median_outlier_rejected',
      'cross_source_consensus_outlier_rejected',
      'insufficient_comparable_sources',
    ]);
    const topRejectReasons = new Map<string, number>();
    const topBlockerReasons = new Map<string, number>();
    const primaryRejectStages = new Map<string, number>();
    const blockerCountsByReason = new Map<string, number>();
    let pairsRejectedForCanonicalOrVariantMismatch = 0;
    let pairsRejectedForFeesOrExecutionNet = 0;
    let pairsRejectedForMinProfit = 0;
    let pairsRejectedForConfidenceThreshold = 0;
    let pairsRejectedForBlockerOrRiskRules = 0;
    let pairsRejectedForFreshnessOrLiquidity = 0;

    for (const record of input.rejectedEvaluations) {
      const reasonCodes = new Set(record.evaluation.reasonCodes);

      for (const reasonCode of reasonCodes) {
        topRejectReasons.set(reasonCode, (topRejectReasons.get(reasonCode) ?? 0) + 1);
      }

      if (record.stageDetails.primaryRejectStage) {
        primaryRejectStages.set(
          record.stageDetails.primaryRejectStage,
          (primaryRejectStages.get(record.stageDetails.primaryRejectStage) ?? 0) +
            1,
        );
      }

      if (record.evaluation.eligibility.blockerReason) {
        topBlockerReasons.set(
          record.evaluation.eligibility.blockerReason,
          (topBlockerReasons.get(record.evaluation.eligibility.blockerReason) ??
            0) + 1,
        );
        blockerCountsByReason.set(
          record.evaluation.eligibility.blockerReason,
          (blockerCountsByReason.get(record.evaluation.eligibility.blockerReason) ??
            0) + 1,
        );
      }

      if ([...reasonCodes].some((reasonCode) => mismatchReasons.has(reasonCode))) {
        pairsRejectedForCanonicalOrVariantMismatch += 1;
      }

      if (
        [...reasonCodes].some((reasonCode) => feeExecutionReasons.has(reasonCode))
      ) {
        pairsRejectedForFeesOrExecutionNet += 1;
      }

      if ([...reasonCodes].some((reasonCode) => minProfitReasons.has(reasonCode))) {
        pairsRejectedForMinProfit += 1;
      }

      if (
        [...reasonCodes].some((reasonCode) => confidenceReasons.has(reasonCode))
      ) {
        pairsRejectedForConfidenceThreshold += 1;
      }

      if (
        record.evaluation.antiFakeAssessment.hardReject ||
        [...reasonCodes].some(
          (reasonCode) =>
            blockerRiskReasons.has(reasonCode) ||
            reasonCode.startsWith('scheme_'),
        )
      ) {
      pairsRejectedForBlockerOrRiskRules += 1;
      }

      if (
        [...reasonCodes].some((reasonCode) =>
          freshnessLiquidityReasons.has(reasonCode),
        )
      ) {
        pairsRejectedForFreshnessOrLiquidity += 1;
      }
    }

    return {
      variantsRejectedForMissingCounterSource:
        input.scannedVariantCount - input.variantsWithCounterSourceCandidate,
      variantsRejectedForLowOverlapOrLowPairability:
        input.variantsRejectedForLowOverlapOrLowPairability,
      pairsRejectedForCanonicalOrVariantMismatch,
      pairsRejectedForFeesOrExecutionNet,
      pairsRejectedForMinProfit,
      pairsRejectedForConfidenceThreshold,
      pairsRejectedForBlockerOrRiskRules,
      pairsRejectedForFreshnessOrLiquidity,
      primaryRejectStages: [...primaryRejectStages.entries()]
        .map(([key, count]) => ({ key, count }))
        .sort((left, right) => {
          if (right.count !== left.count) {
            return right.count - left.count;
          }

          return left.key.localeCompare(right.key);
        })
        .slice(0, 8),
      blockerCountsByReason: [...blockerCountsByReason.entries()]
        .map(([key, count]) => ({ key, count }))
        .sort((left, right) => {
          if (right.count !== left.count) {
            return right.count - left.count;
          }

          return left.key.localeCompare(right.key);
        })
        .slice(0, 8),
      topRejectReasons: [...topRejectReasons.entries()]
        .map(([key, count]) => ({ key, count }))
        .sort((left, right) => {
          if (right.count !== left.count) {
            return right.count - left.count;
          }

          return left.key.localeCompare(right.key);
        })
        .slice(0, 8),
      topBlockerReasons: [...topBlockerReasons.entries()]
        .map(([key, count]) => ({ key, count }))
        .sort((left, right) => {
          if (right.count !== left.count) {
            return right.count - left.count;
          }

          return left.key.localeCompare(right.key);
        })
        .slice(0, 6),
    };
  }

  private describeEvaluationStage(
    evaluation: OpportunityEvaluationDto,
  ): EvaluationStageDetails {
    const reasonCodes = new Set(evaluation.reasonCodes);
    const missingMarketSignal =
      reasonCodes.has('buy_source_has_no_ask') ||
      reasonCodes.has('sell_source_has_no_exit_signal');
    const strictVariantIdentityBlocked =
      reasonCodes.has('strict_variant_key_missing') ||
      reasonCodes.has('strict_variant_key_mismatch');
    const preScoreStale =
      evaluation.preScoreGate.rejectedByStale ||
      reasonCodes.has('stale_pre_score_rejection');
    const preScoreOutlier =
      evaluation.preScoreGate.rejectedByMedian ||
      evaluation.preScoreGate.rejectedByConsensus ||
      evaluation.preScoreGate.rejectedByComparableCount ||
      reasonCodes.has('pre_score_outlier_rejected') ||
      reasonCodes.has('source_median_outlier_rejected') ||
      reasonCodes.has('cross_source_consensus_outlier_rejected') ||
      reasonCodes.has('insufficient_comparable_sources');
    const pairReachedPairability =
      !missingMarketSignal &&
      !strictVariantIdentityBlocked &&
      evaluation.preScoreGate.passed;
    let primaryRejectStage: OpportunityRejectStage | undefined;

    if (evaluation.disposition === 'rejected') {
      if (missingMarketSignal) {
        primaryRejectStage = 'missing_market_signal';
      } else if (strictVariantIdentityBlocked) {
        primaryRejectStage = 'strict_variant_identity';
      } else if (preScoreStale) {
        primaryRejectStage = 'expired_source_state';
      } else if (preScoreOutlier) {
        primaryRejectStage = 'pre_score_outlier';
      } else if (evaluation.antiFakeAssessment.hardReject) {
        primaryRejectStage = 'anti_fake';
      } else if (
        reasonCodes.has('negative_fees_adjusted_spread') ||
        reasonCodes.has('non_positive_raw_spread') ||
        reasonCodes.has('true_non_positive_edge')
      ) {
        primaryRejectStage = 'post_pairability_execution';
      } else if (
        reasonCodes.has('expected_net_below_category_floor') ||
        reasonCodes.has('spread_percent_below_category_floor') ||
        reasonCodes.has('confidence_below_candidate_floor') ||
        reasonCodes.has('confidence_below_eligible_floor')
      ) {
        primaryRejectStage = 'post_pairability_threshold';
      } else if (evaluation.pairability.status === 'listed_exit_only') {
        primaryRejectStage = 'listed_exit_reference_only';
      } else {
        primaryRejectStage = 'unknown';
      }
    }

    return {
      ...(primaryRejectStage ? { primaryRejectStage } : {}),
      pairReachedPairability,
      blockedBeforePairability:
        evaluation.disposition === 'rejected' && !pairReachedPairability,
      blockedAfterPairability:
        evaluation.disposition === 'rejected' && pairReachedPairability,
      nearMissCandidate:
        evaluation.disposition !== 'rejected' && !evaluation.eligibility.eligible,
    };
  }

  private resolveDiagnosticBlockerKey(
    evaluation: OpportunityEvaluationDto,
  ): OpportunityBlockerReason | OpportunityRejectStage | undefined {
    if (evaluation.eligibility.blockerReason) {
      return evaluation.eligibility.blockerReason;
    }

    return this.describeEvaluationStage(evaluation).primaryRejectStage;
  }

  private describeStrictIdentityMismatch(
    evaluation: OpportunityEvaluationDto,
  ): {
    readonly status: 'missing_key' | 'mismatch';
    readonly differingFields: readonly string[];
  } | undefined {
    const buyKey = evaluation.strictTradable.buyKey;
    const sellKey = evaluation.strictTradable.sellKey;

    if (!buyKey || !sellKey) {
      return {
        status: 'missing_key',
        differingFields: [],
      };
    }

    const differingFields: string[] = [];

    if (buyKey.condition !== sellKey.condition) {
      differingFields.push('condition');
    }

    if (buyKey.stattrak !== sellKey.stattrak) {
      differingFields.push('stattrak');
    }

    if (buyKey.souvenir !== sellKey.souvenir) {
      differingFields.push('souvenir');
    }

    if (buyKey.vanilla !== sellKey.vanilla) {
      differingFields.push('vanilla');
    }

    if (buyKey.phase !== sellKey.phase) {
      differingFields.push('phase');
    }

    if (buyKey.patternSensitiveBucket !== sellKey.patternSensitiveBucket) {
      differingFields.push('pattern');
    }

    if (buyKey.floatBucket !== sellKey.floatBucket) {
      differingFields.push('float');
    }

    return {
      status: 'mismatch',
      differingFields,
    };
  }

  private resolvePrePairRejectReason(
    evaluation: OpportunityEvaluationDto,
  ): string | undefined {
    if (
      this.hasAnyReason(evaluation.reasonCodes, [
        'buy_source_has_no_ask',
        'sell_source_has_no_exit_signal',
      ])
    ) {
      return 'missing_market_signal';
    }

    if (
      this.hasAnyReason(evaluation.reasonCodes, [
        'strict_variant_key_missing',
        'strict_variant_key_mismatch',
      ])
    ) {
      return 'strict_variant_identity';
    }

    if (evaluation.preScoreGate.rejectedByStale) {
      return 'expired_source_state';
    }

    if (
      evaluation.preScoreGate.rejectedByMedian ||
      evaluation.preScoreGate.rejectedByConsensus ||
      evaluation.preScoreGate.rejectedByComparableCount
    ) {
      return 'pre_score_outlier';
    }

    if (evaluation.antiFakeAssessment.hardReject) {
      return 'anti_fake';
    }

    return undefined;
  }

  private resolvePostPairRejectReason(
    evaluation: OpportunityEvaluationDto,
  ): string | undefined {
    if (evaluation.disposition !== 'rejected') {
      return undefined;
    }

    if (
      this.hasAnyReason(evaluation.reasonCodes, [
        'negative_fees_adjusted_spread',
        'non_positive_raw_spread',
        'true_non_positive_edge',
      ])
    ) {
      return 'execution_or_spread';
    }

    if (
      this.hasAnyReason(evaluation.reasonCodes, [
        'expected_net_below_category_floor',
        'spread_percent_below_category_floor',
        'confidence_below_candidate_floor',
        'confidence_below_eligible_floor',
      ])
    ) {
      return 'thresholds';
    }

    if (evaluation.pairability.listedExitOnly) {
      return 'listed_exit_only';
    }

    return undefined;
  }

  private resolveRejectBlockerClass(input: {
    readonly prePairRejectReason: string | undefined;
    readonly postPairRejectReason: string | undefined;
  }): 'market_real' | 'system_induced' | 'mixed' {
    const prePairReason = input.prePairRejectReason;
    const postPairReason = input.postPairRejectReason;

    if (prePairReason === 'expired_source_state') {
      return 'system_induced';
    }

    if (
      prePairReason === 'missing_market_signal' ||
      prePairReason === 'strict_variant_identity' ||
      postPairReason === 'listed_exit_only'
    ) {
      return 'market_real';
    }

    return 'mixed';
  }

  private readMaterializedSourceLeg(input: {
    readonly source: SourceAdapterKey;
    readonly sourceName: string;
    readonly snapshotId: string;
    readonly notes: Record<string, unknown>;
  }): OpportunityEvaluationDto['buy'] | null {
    const observedAt = this.readDate(input.notes.observedAt);

    if (!observedAt) {
      return null;
    }

    const marketUrl = this.readString(input.notes.marketUrl);
    const listingUrl = this.readString(input.notes.listingUrl);

    return {
      source: input.source,
      sourceName: this.readString(input.notes.sourceName) ?? input.sourceName,
      ...(marketUrl ? { marketUrl } : {}),
      ...(listingUrl ? { listingUrl } : {}),
      ...(this.readNumber(input.notes.ask) !== undefined
        ? { ask: this.readNumber(input.notes.ask)! }
        : {}),
      ...(this.readNumber(input.notes.bid) !== undefined
        ? { bid: this.readNumber(input.notes.bid)! }
        : {}),
      ...(this.readNumber(input.notes.listedQty) !== undefined
        ? { listedQty: this.readNumber(input.notes.listedQty)! }
        : {}),
      observedAt,
      fetchMode: this.readFetchMode(input.notes.fetchMode),
      confidence: this.readNumber(input.notes.confidence) ?? 0,
      snapshotId: input.snapshotId,
      ...(this.readString(input.notes.rawPayloadArchiveId)
        ? {
            rawPayloadArchiveId: this.readString(
              input.notes.rawPayloadArchiveId,
            )!,
          }
        : {}),
    };
  }

  private readEvaluationDisposition(
    value: unknown,
  ): OpportunityEvaluationDto['disposition'] | undefined {
    return this.readEnum(value, [
      'candidate',
      'near_eligible',
      'eligible',
      'risky_high_upside',
      'rejected',
    ]);
  }

  private readSurfaceTier(
    value: unknown,
  ): OpportunityEvaluationDto['surfaceTier'] | undefined {
    return this.readEnum(value, [
      'tradable',
      'reference_backed',
      'near_eligible',
      'research',
      'rejected',
    ]);
  }

  private readFetchMode(
    value: unknown,
  ): OpportunityEvaluationDto['buy']['fetchMode'] {
    return (
      this.readEnum(value, ['live', 'snapshot', 'fallback', 'backup']) ??
      'live'
    );
  }

  private readPenaltyBreakdown(
    value: unknown,
  ): OpportunityEvaluationDto['penalties'] {
    const record = this.readJsonObject(value);

    return {
      freshnessPenalty: this.readNumber(record.freshnessPenalty) ?? 0,
      liquidityPenalty: this.readNumber(record.liquidityPenalty) ?? 0,
      stalePenalty: this.readNumber(record.stalePenalty) ?? 0,
      categoryPenalty: this.readNumber(record.categoryPenalty) ?? 0,
      sourceDisagreementPenalty:
        this.readNumber(record.sourceDisagreementPenalty) ?? 0,
      backupConfirmationBoost:
        this.readNumber(record.backupConfirmationBoost) ?? 0,
      totalPenalty: this.readNumber(record.totalPenalty) ?? 0,
    };
  }

  private readComponentScores(
    value: unknown,
  ): OpportunityEvaluationDto['componentScores'] {
    const record = this.readJsonObject(value);

    return {
      mappingConfidence: this.readNumber(record.mappingConfidence) ?? 0,
      priceConfidence: this.readNumber(record.priceConfidence) ?? 0,
      liquidityConfidence: this.readNumber(record.liquidityConfidence) ?? 0,
      freshnessConfidence: this.readNumber(record.freshnessConfidence) ?? 0,
      sourceReliabilityConfidence:
        this.readNumber(record.sourceReliabilityConfidence) ?? 0,
      variantMatchConfidence:
        this.readNumber(record.variantMatchConfidence) ?? 0,
    };
  }

  private readExecution(
    value: unknown,
    expectedNetProfit: number,
  ): OpportunityEvaluationDto['execution'] {
    const record = this.readJsonObject(value);

    return {
      realizedSellPrice: this.readNumber(record.realizedSellPrice) ?? 0,
      buyPrice: this.readNumber(record.buyPrice) ?? 0,
      fees: this.readNumber(record.fees) ?? 0,
      slippagePenalty: this.readNumber(record.slippagePenalty) ?? 0,
      liquidityPenalty: this.readNumber(record.liquidityPenalty) ?? 0,
      uncertaintyPenalty: this.readNumber(record.uncertaintyPenalty) ?? 0,
      expectedNet: this.readNumber(record.expectedNet) ?? expectedNetProfit,
    };
  }

  private readAntiFakeAssessment(
    value: unknown,
  ): OpportunityEvaluationDto['antiFakeAssessment'] {
    const record = this.readJsonObject(value);

    return {
      hardReject: this.readBoolean(record.hardReject) ?? false,
      riskScore: this.readNumber(record.riskScore) ?? 0,
      matchConfidence: this.readNumber(record.matchConfidence) ?? 0,
      premiumContaminationRisk:
        this.readNumber(record.premiumContaminationRisk) ?? 0,
      marketSanityRisk: this.readNumber(record.marketSanityRisk) ?? 0,
      confirmationScore: this.readNumber(record.confirmationScore) ?? 0,
      reasonCodes: this.readStringArray(record.reasonCodes).filter((value) =>
        this.isOpportunityReasonCode(value),
      ) as OpportunityReasonCode[],
    };
  }

  private readStrictTradable(
    value: unknown,
  ): OpportunityEvaluationDto['strictTradable'] {
    const record = this.readJsonObject(value);
    const buyKey = this.readStrictTradableKey(record.buyKey);
    const sellKey = this.readStrictTradableKey(record.sellKey);

    return {
      matched: this.readBoolean(record.matched) ?? true,
      ...(buyKey ? { buyKey } : {}),
      ...(sellKey ? { sellKey } : {}),
    };
  }

  private readStrictTradableKey(
    value: unknown,
  ): OpportunityEvaluationDto['strictTradable']['buyKey'] | undefined {
    const record = this.readJsonObject(value);
    const key = this.readString(record.key);
    const condition = this.readString(record.condition);
    const phase = this.readString(record.phase);
    const patternSensitiveBucket = this.readString(
      record.patternSensitiveBucket,
    );
    const floatBucket = this.readString(record.floatBucket);

    if (
      !key ||
      !condition ||
      phase === undefined ||
      patternSensitiveBucket === undefined ||
      floatBucket === undefined
    ) {
      return undefined;
    }

    return {
      key,
      condition,
      stattrak: this.readBoolean(record.stattrak) ?? false,
      souvenir: this.readBoolean(record.souvenir) ?? false,
      vanilla: this.readBoolean(record.vanilla) ?? false,
      phase,
      patternSensitiveBucket,
      floatBucket,
    };
  }

  private readPreScoreGate(
    value: unknown,
    reasonCodes: readonly OpportunityReasonCode[],
  ): OpportunityEvaluationDto['preScoreGate'] {
    const record = this.readJsonObject(value);

    return {
      passed: this.readBoolean(record.passed) ?? true,
      comparableCount: this.readNumber(record.comparableCount) ?? 0,
      ...(this.readNumber(record.sourceMedian) !== undefined
        ? { sourceMedian: this.readNumber(record.sourceMedian)! }
        : {}),
      ...(this.readNumber(record.crossSourceConsensus) !== undefined
        ? {
            crossSourceConsensus: this.readNumber(record.crossSourceConsensus)!,
          }
        : {}),
      rejectedByStale:
        this.readBoolean(record.rejectedByStale) ??
        reasonCodes.includes('stale_pre_score_rejection'),
      rejectedByMedian: this.readBoolean(record.rejectedByMedian) ?? false,
      rejectedByConsensus:
        this.readBoolean(record.rejectedByConsensus) ?? false,
      rejectedByComparableCount:
        this.readBoolean(record.rejectedByComparableCount) ?? false,
      reasonCodes,
    };
  }

  private readEligibility(
    value: unknown,
  ): OpportunityEvaluationDto['eligibility'] {
    const record = this.readJsonObject(value);
    const blockerReason = this.readEnum(record.blockerReason, [
      'steam_snapshot_pair',
      'listed_exit_only',
      'fallback_data',
      'low_expected_net',
      'low_spread_percent',
      'low_confidence',
      'low_liquidity',
      'strict_variant_key_missing',
      'strict_variant_key_mismatch',
      'pre_score_outlier',
      'insufficient_comparables',
      'stale_sources',
    ]);
    const surfaceTier = this.readSurfaceTier(record.surfaceTier);

    return {
      surfaceTier: surfaceTier ?? 'research',
      eligible: this.readBoolean(record.eligible) ?? false,
      requiresReferenceSupport:
        this.readBoolean(record.requiresReferenceSupport) ?? false,
      steamSnapshotDemoted:
        this.readBoolean(record.steamSnapshotDemoted) ?? false,
      ...(blockerReason ? { blockerReason } : {}),
    };
  }

  private readValidation(
    value: unknown,
    reasonCodes: readonly OpportunityReasonCode[],
  ): OpportunityEvaluationDto['validation'] {
    const record = this.readJsonObject(value);
    const status = this.readEnum(record.status, ['passed', 'warned', 'rejected']);

    return {
      status: status ?? 'passed',
      hardReject: this.readBoolean(record.hardReject) ?? false,
      matchConfidence: this.readNumber(record.matchConfidence) ?? 1,
      premiumContaminationRisk:
        this.readNumber(record.premiumContaminationRisk) ?? 0,
      marketSanityRisk: this.readNumber(record.marketSanityRisk) ?? 0,
      confirmationScore: this.readNumber(record.confirmationScore) ?? 0,
      reasonCodes,
    };
  }

  private readPairability(
    value: unknown,
    sell: OpportunityEvaluationDto['sell'],
    reasonCodes: readonly OpportunityReasonCode[],
  ): OpportunityEvaluationDto['pairability'] {
    const record = this.readJsonObject(value);
    const status = this.readEnum(record.status, [
      'pairable',
      'listed_exit_only',
      'blocked',
    ]);

    return {
      status:
        status ??
        (sell.bid === undefined && sell.ask !== undefined
          ? 'listed_exit_only'
          : 'pairable'),
      sameSourceBlocked: this.readBoolean(record.sameSourceBlocked) ?? false,
      listedExitOnly:
        this.readBoolean(record.listedExitOnly) ??
        reasonCodes.includes('sell_source_requires_listed_exit'),
      usesFallbackData:
        this.readBoolean(record.usesFallbackData) ??
        (reasonCodes.includes('stale_snapshot_used') ||
          reasonCodes.includes('steam_snapshot_fallback_used')),
      schemeBlocked: this.readBoolean(record.schemeBlocked) ?? false,
    };
  }

  private readRankingInputs(
    value: unknown,
  ): OpportunityEvaluationDto['rankingInputs'] {
    const record = this.readJsonObject(value);

    return {
      surfaceTierRank: this.readNumber(record.surfaceTierRank) ?? 0,
      dispositionRank: this.readNumber(record.dispositionRank) ?? 0,
      bucketBase: this.readNumber(record.bucketBase) ?? 0,
      qualityScore: this.readNumber(record.qualityScore) ?? 0,
      penaltyScore: this.readNumber(record.penaltyScore) ?? 0,
      rankScore: this.readNumber(record.rankScore) ?? 0,
      freshnessScore: this.readNumber(record.freshnessScore) ?? 0,
      liquidityScore: this.readNumber(record.liquidityScore) ?? 0,
      pairabilityScore: this.readNumber(record.pairabilityScore) ?? 0,
      variantCertainty: this.readNumber(record.variantCertainty) ?? 0,
      sourceReliability: this.readNumber(record.sourceReliability) ?? 0,
      feeAdjustedNetProfit:
        this.readNumber(record.feeAdjustedNetProfit) ?? 0,
      feeAdjustedSpreadPercent:
        this.readNumber(record.feeAdjustedSpreadPercent) ?? 0,
    };
  }

  private readRiskReasons(
    value: unknown,
  ): OpportunityEvaluationDto['riskReasons'] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.flatMap((entry) => {
      const record = this.readJsonObject(entry);
      const code = this.readEnum(
        record.code,
        OPPORTUNITY_RISK_REASON_CODES,
      ) as OpportunityRiskReasonCode | undefined;
      const severity = this.readEnum(record.severity, [
        'info',
        'warning',
        'critical',
      ]);
      const detail = this.readString(record.detail);

      if (!code || !severity || !detail) {
        return [];
      }

      return [
        {
          code,
          severity,
          detail,
        },
      ];
    });
  }

  private readBackupConfirmation(
    value: unknown,
  ): OpportunityEvaluationDto['backupConfirmation'] | undefined {
    const record = this.readJsonObject(value);
    const source = this.readEnum(record.source, SOURCE_ADAPTER_KEYS);
    const sourceName = this.readString(record.sourceName);
    const referencePrice = this.readNumber(record.referencePrice);

    if (!source || !sourceName || referencePrice === undefined) {
      return undefined;
    }

    return {
      source,
      sourceName,
      referencePrice,
    };
  }

  private readLatestRescanMetrics(value: unknown):
    | {
        readonly scannedVariantCount: number;
        readonly variantFunnel: {
          readonly withEvaluatedPairs: number;
          readonly withPairablePairs: number;
        };
        readonly pairFunnel: {
          readonly evaluated: number;
          readonly blocked: number;
          readonly listedExitOnly: number;
          readonly softListedExitOnly: number;
          readonly pairable: number;
          readonly buySourceHasNoAsk: number;
          readonly sellSourceHasNoExitSignal: number;
          readonly strictVariantKeyMissing: number;
          readonly strictVariantKeyMismatch: number;
          readonly preScoreRejected: number;
          readonly nearEqualAfterFees: number;
          readonly trueNonPositiveEdge: number;
          readonly negativeExpectedNet: number;
          readonly confidenceBelowCandidateFloor: number;
        };
        readonly topRejectReasons: readonly Record<string, unknown>[];
        readonly topBlockerReasons: readonly Record<string, unknown>[];
      }
    | undefined {
    const record = this.readJsonObject(value);
    const variantFunnel = this.readJsonObject(record.variantFunnel);
    const pairFunnel = this.readJsonObject(record.pairFunnel);
    const scannedVariantCount = this.readNumber(record.scannedVariantCount);

    if (scannedVariantCount === undefined) {
      return undefined;
    }

    return {
      scannedVariantCount,
      variantFunnel: {
        withEvaluatedPairs: this.readNumber(variantFunnel.withEvaluatedPairs) ?? 0,
        withPairablePairs: this.readNumber(variantFunnel.withPairablePairs) ?? 0,
      },
      pairFunnel: {
        evaluated: this.readNumber(pairFunnel.evaluated) ?? 0,
        blocked: this.readNumber(pairFunnel.blocked) ?? 0,
        listedExitOnly: this.readNumber(pairFunnel.listedExitOnly) ?? 0,
        softListedExitOnly:
          this.readNumber(pairFunnel.softListedExitOnly) ?? 0,
        pairable: this.readNumber(pairFunnel.pairable) ?? 0,
        buySourceHasNoAsk: this.readNumber(pairFunnel.buySourceHasNoAsk) ?? 0,
        sellSourceHasNoExitSignal:
          this.readNumber(pairFunnel.sellSourceHasNoExitSignal) ?? 0,
        strictVariantKeyMissing:
          this.readNumber(pairFunnel.strictVariantKeyMissing) ?? 0,
        strictVariantKeyMismatch:
          this.readNumber(pairFunnel.strictVariantKeyMismatch) ?? 0,
        preScoreRejected: this.readNumber(pairFunnel.preScoreRejected) ?? 0,
        nearEqualAfterFees:
          this.readNumber(pairFunnel.nearEqualAfterFees) ?? 0,
        trueNonPositiveEdge:
          this.readNumber(pairFunnel.trueNonPositiveEdge) ?? 0,
        negativeExpectedNet:
          this.readNumber(pairFunnel.negativeExpectedNet) ?? 0,
        confidenceBelowCandidateFloor:
          this.readNumber(pairFunnel.confidenceBelowCandidateFloor) ?? 0,
      },
      topRejectReasons: Array.isArray(record.topRejectReasons)
        ? record.topRejectReasons.map((entry) => this.readJsonObject(entry))
        : [],
      topBlockerReasons: Array.isArray(record.topBlockerReasons)
        ? record.topBlockerReasons.map((entry) => this.readJsonObject(entry))
        : [],
    };
  }

  private readDiagnosticCounts(
    value: readonly Record<string, unknown>[] | undefined,
    keyField: 'reasonCode' | 'blockerReason',
  ): readonly { readonly key: string; readonly count: number }[] {
    if (!value) {
      return [];
    }

    return value.flatMap((entry) => {
      const key = this.readString(entry[keyField]);
      const count = this.readNumber(entry.count);

      if (!key || count === undefined) {
        return [];
      }

      return [{ key, count }];
    });
  }

  private toRiskClass(
    value: MaterializedOpportunityRecord['riskClass'],
  ): OpportunityEvaluationDto['riskClass'] {
    switch (value) {
      case 'LOW':
        return 'low';
      case 'MEDIUM':
        return 'medium';
      case 'HIGH':
        return 'high';
      case 'EXTREME':
        return 'extreme';
    }
  }

  private toDecimalNumber(value: { toString(): string }): number {
    return Number(value.toString());
  }

  private readJsonObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }

  private readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : undefined;
  }

  private readStringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string')
      : [];
  }

  private readBoolean(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
  }

  private readNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      const parsedValue = Number(value);

      return Number.isFinite(parsedValue) ? parsedValue : undefined;
    }

    return undefined;
  }

  private readDate(value: unknown): Date | undefined {
    if (value instanceof Date) {
      return value;
    }

    if (typeof value !== 'string' || value.trim().length === 0) {
      return undefined;
    }

    const parsedValue = new Date(value);

    return Number.isNaN(parsedValue.getTime()) ? undefined : parsedValue;
  }

  private readEnum<T extends string>(
    value: unknown,
    values: readonly T[],
  ): T | undefined {
    return typeof value === 'string' && values.includes(value as T)
      ? (value as T)
      : undefined;
  }

  private isOpportunityReasonCode(value: string): boolean {
    return ([
      'meets_candidate_thresholds',
      'meets_near_eligible_thresholds',
      'meets_eligible_thresholds',
      'high_upside_with_elevated_risk',
      'buy_source_has_no_ask',
      'sell_source_has_no_exit_signal',
      'buy_sell_same_source',
      'non_positive_raw_spread',
      'negative_fees_adjusted_spread',
      'near_equal_after_fees',
      'true_non_positive_edge',
      'expected_net_below_category_floor',
      'spread_percent_below_category_floor',
      'confidence_below_candidate_floor',
      'confidence_below_eligible_floor',
      'freshness_penalty_elevated',
      'liquidity_penalty_elevated',
      'stale_penalty_elevated',
      'category_penalty_elevated',
      'source_disagreement_penalty_elevated',
      'sell_source_requires_listed_exit',
      'steam_snapshot_fallback_used',
      'steam_snapshot_pair_demoted',
      'stale_snapshot_used',
      'backup_reference_confirms_band',
      'backup_reference_outlier',
      'strict_variant_key_missing',
      'strict_variant_key_mismatch',
      'pre_score_outlier_rejected',
      'source_median_outlier_rejected',
      'cross_source_consensus_outlier_rejected',
      'insufficient_comparable_sources',
      'stale_pre_score_rejection',
      'MISMATCH_EXTERIOR',
      'MISMATCH_STATTRAK',
      'MISMATCH_SOUVENIR',
      'MISMATCH_PHASE',
      'LOW_MATCH_CONFIDENCE',
      'UNKNOWN_FLOAT_PREMIUM',
      'UNKNOWN_STICKER_PREMIUM',
      'UNKNOWN_PATTERN_PREMIUM',
      'UNKNOWN_PHASE_PREMIUM',
      'STALE_SOURCE_STATE',
      'LOW_SOURCE_CONFIDENCE',
      'OUTLIER_PRICE',
      'INSUFFICIENT_LIQUIDITY',
      'FROZEN_MARKET',
      'NO_CONFIRMING_SOURCE',
      'scheme_category_not_allowed',
      'scheme_variant_not_allowed',
      'scheme_buy_source_not_allowed',
      'scheme_sell_source_not_allowed',
      'scheme_source_pair_excluded',
      'scheme_profit_below_floor',
      'scheme_confidence_below_floor',
      'scheme_liquidity_below_floor',
      'scheme_buy_cost_out_of_range',
      'scheme_disposition_below_floor',
      'scheme_risk_above_ceiling',
      'scheme_fallback_blocked',
      'scheme_listed_exit_blocked',
      'scheme_risky_high_upside_blocked',
    ] as const).includes(value as OpportunityReasonCode);
  }

  private hasAnyReason(
    reasonCodes: readonly OpportunityReasonCode[],
    targets: readonly OpportunityReasonCode[],
  ): boolean {
    return targets.some((reasonCode) => reasonCodes.includes(reasonCode));
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
