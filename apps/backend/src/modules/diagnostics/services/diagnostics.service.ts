import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  HealthStatus,
  JobRunStatus,
  SyncStatus,
  UserRole,
  type Prisma,
} from '@prisma/client';

import { AppConfigService } from '../../../infrastructure/config/app-config.service';
import { ReadPathDegradationService } from '../../../infrastructure/redis/read-path-degradation.service';
import type { AuthUserRecord } from '../../auth/domain/auth.repository';
import { SchedulerLockService } from '../../jobs/services/scheduler-lock.service';
import { MarketFreshnessPolicyService } from '../../market-state/services/market-freshness-policy.service';
import type { OpportunityReasonCode } from '../../opportunities/domain/opportunity-engine.model';
import type { OpportunityEngineScanResultDto } from '../../opportunities/dto/opportunity-engine.dto';
import { OpportunityEngineService } from '../../opportunities/services/opportunity-engine.service';
import { ScannerUniverseService } from '../../opportunities/services/scanner-universe.service';
import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';
import { SourceOperationalProfileService } from '../../source-adapters/services/source-operational-profile.service';
import { SourceRuntimeGuardService } from '../../source-adapters/services/source-runtime-guard.service';
import type { DiagnosticsUseCase } from '../application/diagnostics.use-case';
import {
  DIAGNOSTICS_REPOSITORY,
  type DiagnosticsHealthMetricWithSourceRecord,
  type DiagnosticsJobRunRecord,
  type DiagnosticsPendingSourceMappingRecord,
  type DiagnosticsRepository,
  type DiagnosticsSourcePairOverlapRecord,
  type DiagnosticsSourceOverviewRecord,
  type DiagnosticsSourceSyncStatusRecord,
} from '../domain/diagnostics.repository';
import type {
  CsFloatCoverageDiagnosticsDto,
  DiagnosticsFreshnessCountsDto,
  DiagnosticsJobRunHistoryItemDto,
  JobRunHistoryDto,
  MarketStateFreshnessDistributionDto,
  MarketStateFreshnessDistributionItemDto,
  PairRejectionBucketCountsDto,
  OpportunityRejectReasonMetricDto,
  OpportunityRejectReasonsDto,
  QueueLagMetricsDto,
  RateLimitBurnMetricDto,
  RateLimitBurnMetricsDto,
  SourceHealthDashboardDto,
  SourceHealthDashboardItemDto,
  SourceOperationalSummaryDto,
  SourcePairOverlapSummaryDto,
  SourceSyncFailureItemDto,
  SourceSyncFailuresDto,
  UnresolvedMappingDiagnosticsDto,
  UnresolvedMappingItemDto,
  UnresolvedSignalKind,
} from '../dto/diagnostics.dto';
import type { GetDiagnosticsRecordsQueryDto } from '../dto/get-diagnostics-records.query.dto';
import type { GetDiagnosticsRejectReasonsQueryDto } from '../dto/get-diagnostics-reject-reasons.query.dto';

const DEFAULT_RECORD_LIMIT = 25;
const DEFAULT_LOOKBACK_HOURS = 72;
const DEFAULT_RATE_LIMIT_LOOKBACK_HOURS = 48;
const DEFAULT_JOB_HISTORY_LIMIT = 50;
const DEFAULT_REJECT_TOP = 10;
const DEFAULT_REJECT_SCAN_LIMIT = 40;
const DEFAULT_REJECT_MAX_PAIRS = 24;
const MAX_UNRESOLVED_SIGNAL_SCAN = 300;
const USEFUL_PAYLOAD_RATIO_WINDOW_SIZE = 25;
const CSFLOAT_HOT_COVERAGE_WINDOW_SIZE = 400;
const CSFLOAT_DETAIL_FETCH_RATIO_WINDOW_SIZE = 100;
const SOURCE_OPERATIONAL_SUMMARY_CACHE_TTL_MS = 60 * 1000;
const SLOW_SOURCE_OPERATIONAL_SUMMARY_THRESHOLD_MS = 5_000;
const READ_PATH_DEGRADED_TTL_MS = 15 * 60 * 1000;

interface ComputedFreshnessDistribution {
  readonly overall: DiagnosticsFreshnessCountsDto;
  readonly sources: readonly MarketStateFreshnessDistributionItemDto[];
  readonly freshnessBySourceId: ReadonlyMap<
    string,
    DiagnosticsFreshnessCountsDto
  >;
}

interface RateLimitDefinition {
  readonly source: RateLimitBurnMetricDto['source'];
  readonly endpointName: string;
  readonly windowLimit?: number;
  readonly note?: string;
}

interface UnresolvedSignal {
  readonly source: UnresolvedMappingItemDto['source'];
  readonly sourceName: string;
  readonly message: string;
  readonly detectedAt: Date;
  readonly evidenceKind: UnresolvedSignalKind;
  readonly itemHint?: string;
}

@Injectable()
export class DiagnosticsService implements DiagnosticsUseCase {
  private readonly logger = new Logger(DiagnosticsService.name);
  private readonly sourceOperationalSummaryCache = new Map<
    string,
    {
      readonly expiresAtMs: number;
      readonly value: SourceOperationalSummaryDto;
    }
  >();
  private readonly sourceOperationalSummaryInflight = new Map<
    string,
    Promise<SourceOperationalSummaryDto>
  >();

  constructor(
    @Inject(DIAGNOSTICS_REPOSITORY)
    private readonly diagnosticsRepository: DiagnosticsRepository,
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
    @Inject(SchedulerLockService)
    private readonly schedulerLockService: SchedulerLockService,
    @Inject(ReadPathDegradationService)
    private readonly readPathDegradationService: ReadPathDegradationService,
    @Inject(MarketFreshnessPolicyService)
    private readonly marketFreshnessPolicyService: MarketFreshnessPolicyService,
    @Inject(OpportunityEngineService)
    private readonly opportunityEngineService: OpportunityEngineService,
    @Inject(ScannerUniverseService)
    private readonly scannerUniverseService: ScannerUniverseService,
    @Inject(SourceOperationalProfileService)
    private readonly sourceOperationalProfileService: SourceOperationalProfileService,
    @Inject(SourceRuntimeGuardService)
    private readonly sourceRuntimeGuardService: SourceRuntimeGuardService,
  ) {}

  async getSourceHealthDashboard(
    user: Pick<AuthUserRecord, 'role'>,
  ): Promise<SourceHealthDashboardDto> {
    this.assertAdminUser(user, 'source diagnostics dashboard');

    const generatedAt = new Date();
    const sourceOverviewRecords =
      await this.diagnosticsRepository.listSourceOverviewRecords();
    const freshnessDistribution = await this.buildFreshnessDistribution(
      sourceOverviewRecords,
      generatedAt,
    );
    const runtimeStates = new Map<
      SourceAdapterKey,
      Awaited<ReturnType<SourceRuntimeGuardService['inspect']>>
    >(
      await Promise.all(
        sourceOverviewRecords.map(async (sourceRecord) => [
          sourceRecord.code,
          await this.sourceRuntimeGuardService.inspect(sourceRecord.code),
        ] as const),
      ),
    );
    const sources = sourceOverviewRecords
      .map((sourceRecord) =>
        this.toSourceHealthDashboardItem(
          sourceRecord,
          freshnessDistribution.freshnessBySourceId.get(sourceRecord.id) ??
            this.createEmptyFreshnessCounts(),
          runtimeStates.get(sourceRecord.code),
        ),
      )
      .sort((left, right) => this.compareSourceHealthItems(left, right));

    return {
      generatedAt,
      summary: {
        sourceCount: sources.length,
        okSources: sources.filter((source) => source.healthStatus === 'OK')
          .length,
        degradedSources: sources.filter(
          (source) => source.healthStatus === 'DEGRADED',
        ).length,
        failedSources: sources.filter(
          (source) => source.healthStatus === 'FAILED',
        ).length,
        unknownSources: sources.filter(
          (source) => source.healthStatus === 'UNKNOWN',
        ).length,
        totalTrackedItems: freshnessDistribution.overall.totalItems,
        staleTrackedItems: freshnessDistribution.overall.staleItems,
        expiredTrackedItems: freshnessDistribution.overall.expiredItems,
      },
      sources,
    };
  }

  async getQueueLagMetrics(
    user: Pick<AuthUserRecord, 'role'>,
  ): Promise<QueueLagMetricsDto> {
    this.assertAdminUser(user, 'queue lag diagnostics');

    const generatedAt = new Date();
    const [currentQueueLagRecords, recentQueueOutcomeRecords, maintenanceLocks] =
      await Promise.all([
        this.diagnosticsRepository.listCurrentQueueLagRecords(),
        this.diagnosticsRepository.listQueueOutcomeRecords(
          new Date(generatedAt.getTime() - 24 * 60 * 60 * 1000),
        ),
        Promise.all([
          this.schedulerLockService.inspect('tick'),
          this.schedulerLockService.inspect('market-state-rebuild'),
          this.schedulerLockService.inspect('opportunity-rescan'),
        ]),
      ]);
    const queueNames = new Set<string>();

    for (const record of currentQueueLagRecords) {
      queueNames.add(record.queueName);
    }

    for (const record of recentQueueOutcomeRecords) {
      queueNames.add(record.queueName);
    }

    const queues = [...queueNames]
      .map((queueName) => {
        const queuedRecord = currentQueueLagRecords.find(
          (record) =>
            record.queueName === queueName &&
            record.status === JobRunStatus.QUEUED,
        );
        const runningRecord = currentQueueLagRecords.find(
          (record) =>
            record.queueName === queueName &&
            record.status === JobRunStatus.RUNNING,
        );

        return {
          queueName,
          queuedCount: queuedRecord?.count ?? 0,
          runningCount: runningRecord?.count ?? 0,
          backlogCount:
            (queuedRecord?.count ?? 0) + (runningRecord?.count ?? 0),
          ...(queuedRecord?.minQueuedAt
            ? {
                oldestQueuedAgeMs: Math.max(
                  0,
                  generatedAt.getTime() - queuedRecord.minQueuedAt.getTime(),
                ),
              }
            : {}),
          ...(runningRecord?.minStartedAt
            ? {
                oldestRunningAgeMs: Math.max(
                  0,
                  generatedAt.getTime() - runningRecord.minStartedAt.getTime(),
                ),
              }
            : {}),
          succeededLast24h: this.getQueueOutcomeCount(
            recentQueueOutcomeRecords,
            queueName,
            JobRunStatus.SUCCEEDED,
          ),
          failedLast24h: this.getQueueOutcomeCount(
            recentQueueOutcomeRecords,
            queueName,
            JobRunStatus.FAILED,
          ),
          canceledLast24h: this.getQueueOutcomeCount(
            recentQueueOutcomeRecords,
            queueName,
            JobRunStatus.CANCELED,
          ),
        };
      })
      .sort((left, right) => {
        if (right.backlogCount !== left.backlogCount) {
          return right.backlogCount - left.backlogCount;
        }

        if (right.failedLast24h !== left.failedLast24h) {
          return right.failedLast24h - left.failedLast24h;
        }

        return left.queueName.localeCompare(right.queueName);
      });

    return {
      generatedAt,
      summary: {
        queuedCount: queues.reduce(
          (total, queue) => total + queue.queuedCount,
          0,
        ),
        runningCount: queues.reduce(
          (total, queue) => total + queue.runningCount,
          0,
        ),
        backlogCount: queues.reduce(
          (total, queue) => total + queue.backlogCount,
          0,
        ),
        failedLast24h: queues.reduce(
          (total, queue) => total + queue.failedLast24h,
          0,
        ),
      },
      queues,
      maintenanceLocks,
    };
  }

  async getRateLimitBurnMetrics(
    query: GetDiagnosticsRecordsQueryDto,
    user: Pick<AuthUserRecord, 'role'>,
  ): Promise<RateLimitBurnMetricsDto> {
    this.assertAdminUser(user, 'rate limit diagnostics');

    const generatedAt = new Date();
    const lookbackHours =
      query.lookbackHours ?? DEFAULT_RATE_LIMIT_LOOKBACK_HOURS;
    const recentHealthMetrics =
      await this.diagnosticsRepository.listRecentHealthMetrics({
        ...(query.source ? { source: query.source } : {}),
        since: new Date(generatedAt.getTime() - lookbackHours * 60 * 60 * 1000),
        limit: Math.max(query.limit ?? DEFAULT_RECORD_LIMIT, 50),
        rateLimitOnly: true,
      });
    const latestMetricByKey = new Map<
      string,
      DiagnosticsHealthMetricWithSourceRecord
    >();

    for (const metric of recentHealthMetrics) {
      const endpointName = this.extractEndpointName(metric.details);
      const exactKey = `${metric.sourceCode}:${endpointName ?? 'source'}`;

      if (!latestMetricByKey.has(exactKey)) {
        latestMetricByKey.set(exactKey, metric);
      }

      const fallbackKey = `${metric.sourceCode}:source`;

      if (!latestMetricByKey.has(fallbackKey)) {
        latestMetricByKey.set(fallbackKey, metric);
      }
    }

    return {
      generatedAt,
      metrics: this.getRateLimitDefinitions(query.source).map((definition) =>
        this.toRateLimitBurnMetric(definition, latestMetricByKey),
      ),
    };
  }

  async getSourceOperationalSummary(
    query: GetDiagnosticsRecordsQueryDto,
    user: Pick<AuthUserRecord, 'role'>,
  ): Promise<SourceOperationalSummaryDto> {
    this.assertAdminUser(user, 'source operational summary');
    const cacheKey = query.source ?? 'all';
    const cached = this.sourceOperationalSummaryCache.get(cacheKey);

    if (cached && cached.expiresAtMs > Date.now()) {
      return cached.value;
    }

    const inflight = this.sourceOperationalSummaryInflight.get(cacheKey);

    if (inflight) {
      return inflight;
    }

    const request = this.buildSourceOperationalSummary(query, cacheKey);

    this.sourceOperationalSummaryInflight.set(cacheKey, request);

    try {
      return await request;
    } finally {
      this.sourceOperationalSummaryInflight.delete(cacheKey);
    }
  }

  private async buildSourceOperationalSummary(
    query: GetDiagnosticsRecordsQueryDto,
    cacheKey: string,
  ): Promise<SourceOperationalSummaryDto> {
    const startedAt = Date.now();
    const generatedAt = new Date();
    const [
      sourceOverviewRecords,
      rawPayloadArchiveCounts,
      sourceListingCounts,
      sourceMarketFactCounts,
      marketSnapshotCounts,
      marketStateCounts,
      overlapCoverage,
      pendingMappingCounts,
      recentRawPayloadArchiveCounts,
      recentUsefulRawPayloadCounts,
      projectionSkipCounts,
      latestNormalizedBySource,
      latestRawPayloadByEndpoint,
      sourcePairOverlap,
      csfloatCoverage,
    ] = await Promise.all([
      this.diagnosticsRepository.listSourceOverviewRecords(),
      this.diagnosticsRepository.listRawPayloadArchiveCounts(),
      this.diagnosticsRepository.listSourceListingCounts(),
      this.diagnosticsRepository.listSourceMarketFactCounts(),
      this.diagnosticsRepository.listMarketSnapshotCounts(),
      this.diagnosticsRepository.listMarketStateCounts(),
      this.diagnosticsRepository.getOverlapCoverage(),
      this.diagnosticsRepository.listPendingSourceMappingCounts({
        ...(query.source ? { source: query.source } : {}),
        unresolvedOnly: true,
      }),
      this.diagnosticsRepository.listRecentRawPayloadArchiveCounts(
        USEFUL_PAYLOAD_RATIO_WINDOW_SIZE,
      ),
      this.diagnosticsRepository.listRecentUsefulRawPayloadCounts(
        USEFUL_PAYLOAD_RATIO_WINDOW_SIZE,
      ),
      this.diagnosticsRepository.listProjectionSkipCounts(),
      this.diagnosticsRepository.listLatestNormalizedAtBySource(),
      this.diagnosticsRepository.listLatestRawPayloadObservedAtByEndpoint(),
      this.diagnosticsRepository.listPairableVariantCountsBySourcePair(),
      !query.source || query.source === 'csfloat'
        ? this.buildCsFloatCoverageDiagnostics()
        : Promise.resolve(undefined),
    ]);
    const rawArchiveCountsBySource = this.toSourceCountMap(rawPayloadArchiveCounts);
    const listingCountsBySource = this.toSourceCountMap(sourceListingCounts);
    const marketFactCountsBySource = this.toSourceCountMap(sourceMarketFactCounts);
    const snapshotCountsBySource = this.toSourceCountMap(marketSnapshotCounts);
    const marketStateCountsBySource = this.toSourceCountMap(marketStateCounts);
    const pendingMappingCountsBySource = this.toSourceCountMap(pendingMappingCounts);
    const recentRawPayloadArchiveCountsBySource = this.toSourceCountMap(
      recentRawPayloadArchiveCounts,
    );
    const recentUsefulRawPayloadCountsBySource = this.toSourceCountMap(
      recentUsefulRawPayloadCounts,
    );
    const projectionSkipCountsBySource =
      this.toSourceCountMap(projectionSkipCounts);
    const latestNormalizedAtBySource =
      this.toSourceTimestampMap(latestNormalizedBySource);
    const latestRawPayloadByEndpointBySource =
      this.toSourceEndpointTimestampMap(latestRawPayloadByEndpoint);
    const overlapBySource = this.buildOverlapSummaryBySource(sourcePairOverlap);
    const runtimeStates = new Map<
      SourceAdapterKey,
      Awaited<ReturnType<SourceRuntimeGuardService['inspect']>>
    >(
      await Promise.all(
        sourceOverviewRecords.map(async (sourceRecord) => [
          sourceRecord.code,
          await this.sourceRuntimeGuardService.inspect(sourceRecord.code),
        ] as const),
      ),
    );

    const result = {
      generatedAt,
      variantsWithTwoPlusSources: overlapCoverage.variantsWithTwoPlusSources,
      variantsWithThreePlusSources:
        overlapCoverage.variantsWithThreePlusSources,
      ...(csfloatCoverage ? { csfloatCoverage } : {}),
      sources: sourceOverviewRecords
        .filter((sourceRecord) =>
          query.source ? sourceRecord.code === query.source : true,
        )
        .map((sourceRecord) => {
          const sourceMetadata = this.toJsonObject(sourceRecord.metadata);
          const operationalMetadata = this.toJsonObject(sourceMetadata.operational);
          const classification =
            typeof sourceMetadata.classification === 'string'
              ? sourceMetadata.classification
              : undefined;
          const runtimeState = runtimeStates.get(sourceRecord.code);
          const overlapSummary = overlapBySource.get(sourceRecord.code) ?? {
            canonicalOverlapVariantCount: 0,
            pairableOverlapVariantCount: 0,
            blockedOverlapVariantCount: 0,
            averageOverlapQualityScore: undefined,
          };
          const rawPayloadArchivesCount =
            rawArchiveCountsBySource.get(sourceRecord.code) ?? 0;
          const sourceListingsCount =
            listingCountsBySource.get(sourceRecord.code) ?? 0;
          const sourceMarketFactsCount =
            marketFactCountsBySource.get(sourceRecord.code) ?? 0;
          const marketSnapshotsCount =
            snapshotCountsBySource.get(sourceRecord.code) ?? 0;
          const marketStatesCount =
            marketStateCountsBySource.get(sourceRecord.code) ?? 0;
          const pendingMappingsCount =
            pendingMappingCountsBySource.get(sourceRecord.code) ?? 0;
          const recentRawPayloadCount =
            recentRawPayloadArchiveCountsBySource.get(sourceRecord.code) ?? 0;
          const usefulPayloadCount =
            recentUsefulRawPayloadCountsBySource.get(sourceRecord.code) ?? 0;
          const unchangedProjectionSkipCount =
            projectionSkipCountsBySource.get(sourceRecord.code) ?? 0;
          const latestNormalizedAt =
            latestNormalizedAtBySource.get(sourceRecord.code);
          const latestStateCapableRawObservedAt =
            this.resolveLatestStateCapableRawObservedAt(
              sourceRecord.code,
              latestRawPayloadByEndpointBySource.get(sourceRecord.code),
            );

          return {
            source: sourceRecord.code,
            sourceName: sourceRecord.name,
            sourceKind: sourceRecord.kind,
            isEnabled: sourceRecord.isEnabled,
            ...(classification ? { classification } : {}),
            ...(typeof operationalMetadata.integrationModel === 'string'
              ? { integrationModel: operationalMetadata.integrationModel }
              : {}),
            ...(typeof operationalMetadata.stage === 'string'
              ? { operationalStage: operationalMetadata.stage }
              : {}),
            ...(runtimeState ? { runtimeState: runtimeState.mode } : {}),
            ...(runtimeState?.reason ? { runtimeReason: runtimeState.reason } : {}),
            requiresProxy: operationalMetadata.proxyRequirement === 'required',
            requiresSession:
              operationalMetadata.sessionRequirement === 'required' ||
              operationalMetadata.cookieRequirement === 'required',
            requiresAccount: operationalMetadata.accountRequirement === 'required',
            rawPayloadArchivesCount,
            sourceListingsCount,
            sourceMarketFactsCount,
            marketSnapshotsCount,
            marketStatesCount,
            pendingMappingsCount,
            unresolvedMappingSignalCount: pendingMappingsCount,
            unchangedProjectionSkipCount,
            ...(sourceRecord.latestRawPayloadObservedAt
              ? {
                  latestRawPayloadObservedAt:
                    sourceRecord.latestRawPayloadObservedAt,
                }
              : {}),
            ...(sourceRecord.latestMarketStateObservedAt
              ? {
                  latestMarketStateObservedAt:
                    sourceRecord.latestMarketStateObservedAt,
                }
              : {}),
            ...(latestNormalizedAt ? { latestNormalizedAt } : {}),
            ...(latestStateCapableRawObservedAt &&
            sourceRecord.latestMarketStateObservedAt
              ? {
                  rawToStateLagMs: Math.max(
                    0,
                    latestStateCapableRawObservedAt.getTime() -
                      sourceRecord.latestMarketStateObservedAt.getTime(),
                  ),
                }
              : {}),
            projectionAmplificationRatio: this.toRatio(
              marketSnapshotsCount,
              marketStatesCount,
            ),
            usefulPayloadRatio: this.toPercent(
              usefulPayloadCount / Math.max(1, recentRawPayloadCount),
            ),
            canonicalOverlapVariantCount:
              overlapSummary.canonicalOverlapVariantCount,
            pairableOverlapVariantCount:
              overlapSummary.pairableOverlapVariantCount,
            blockedOverlapVariantCount:
              overlapSummary.blockedOverlapVariantCount,
            ...(overlapSummary.averageOverlapQualityScore !== undefined
              ? {
                  averageOverlapQualityScore:
                    overlapSummary.averageOverlapQualityScore,
                }
              : {}),
          };
        })
        .sort((left, right) => {
          if (right.marketStatesCount !== left.marketStatesCount) {
            return right.marketStatesCount - left.marketStatesCount;
          }

          if (right.rawPayloadArchivesCount !== left.rawPayloadArchivesCount) {
            return right.rawPayloadArchivesCount - left.rawPayloadArchivesCount;
          }

          if (right.sourceListingsCount !== left.sourceListingsCount) {
            return right.sourceListingsCount - left.sourceListingsCount;
          }

          return left.sourceName.localeCompare(right.sourceName);
        }),
    };

    const durationMs = Date.now() - startedAt;

    this.sourceOperationalSummaryCache.set(cacheKey, {
      expiresAtMs: Date.now() + SOURCE_OPERATIONAL_SUMMARY_CACHE_TTL_MS,
      value: result,
    });

    if (process.env.NODE_ENV !== 'test') {
      this.logger.log(
        `getSourceOperationalSummary durationMs=${durationMs} source=${query.source ?? 'all'} sourceCount=${result.sources.length}`,
      );
    }

    if (durationMs >= SLOW_SOURCE_OPERATIONAL_SUMMARY_THRESHOLD_MS) {
      await this.readPathDegradationService.trip({
        reason: 'source_operational_summary_slow',
        ttlMs: READ_PATH_DEGRADED_TTL_MS,
        details: {
          durationMs,
          source: query.source ?? 'all',
          sourceCount: result.sources.length,
        },
      });
    }

    return result;
  }
  private async buildCsFloatCoverageDiagnostics(): Promise<
    CsFloatCoverageDiagnosticsDto | undefined
  > {
    const scannerUniverse = await this.scannerUniverseService.getScannerUniverse({
      limit: CSFLOAT_HOT_COVERAGE_WINDOW_SIZE,
    });
    const hotVariantIds = scannerUniverse.items
      .filter((item) => item.tier === 'hot')
      .map((item) => item.itemVariantId);
    const coverage = await this.diagnosticsRepository.getCsFloatCoverageMetrics({
      hotVariantIds,
      recentDetailFetchLimit: CSFLOAT_DETAIL_FETCH_RATIO_WINDOW_SIZE,
    });
    const csfloatHotVariantCoverage =
      coverage.hotVariantCount > 0
        ? coverage.csfloatCoveredHotVariantCount / coverage.hotVariantCount
        : 0;
    const csfloatListingsPerHotVariant =
      coverage.hotVariantCount > 0
        ? coverage.csfloatActiveListingsOnHotVariants / coverage.hotVariantCount
        : 0;
    const usefulDetailFetchRatio =
      coverage.recentDetailFetchCount > 0
        ? coverage.recentUsefulDetailFetchCount /
          coverage.recentDetailFetchCount
        : undefined;

    return {
      skinportTrackedVariantCount: coverage.skinportTrackedVariantCount,
      csfloatTrackedVariantCount: coverage.csfloatTrackedVariantCount,
      overlapWithSkinportCount: coverage.overlapWithSkinportCount,
      csfloatOverlapEligibleVariantCount:
        coverage.csfloatOverlapEligibleVariantCount,
      csfloatCoverageGapVsSkinport: Math.max(
        0,
        coverage.skinportTrackedVariantCount -
          coverage.overlapWithSkinportCount,
      ),
      hotVariantCount: coverage.hotVariantCount,
      csfloatCoveredHotVariantCount: coverage.csfloatCoveredHotVariantCount,
      csfloatHotVariantCoverage: Number(
        csfloatHotVariantCoverage.toFixed(4),
      ),
      csfloatActiveListingCount: coverage.csfloatActiveListingCount,
      csfloatListingsPerHotVariant: Number(
        csfloatListingsPerHotVariant.toFixed(4),
      ),
      recentDetailFetchCount: coverage.recentDetailFetchCount,
      recentUsefulDetailFetchCount: coverage.recentUsefulDetailFetchCount,
      ...(usefulDetailFetchRatio !== undefined
        ? { usefulDetailFetchRatio: Number(usefulDetailFetchRatio.toFixed(4)) }
        : {}),
    };
  }

  async getSourcePairOverlapSummary(
    query: GetDiagnosticsRecordsQueryDto,
    user: Pick<AuthUserRecord, 'role'>,
  ): Promise<SourcePairOverlapSummaryDto> {
    this.assertAdminUser(user, 'source pair overlap diagnostics');

    const generatedAt = new Date();
    const [
      sourceOverviewRecords,
      overlapCoverage,
      sourcePairs,
      latestOpportunityRescan,
    ] = await Promise.all([
      this.diagnosticsRepository.listSourceOverviewRecords(),
      this.diagnosticsRepository.getOverlapCoverage(),
      this.diagnosticsRepository.listPairableVariantCountsBySourcePair(),
      this.diagnosticsRepository.findLatestOpportunityRescanRecord(),
    ]);
    const sourceOverviewByCode = new Map(
      sourceOverviewRecords.map(
        (sourceRecord) => [sourceRecord.code, sourceRecord] as const,
      ),
    );

    return {
      generatedAt,
      variantsWithTwoPlusSources: overlapCoverage.variantsWithTwoPlusSources,
      variantsWithThreePlusSources:
        overlapCoverage.variantsWithThreePlusSources,
      pairableSourcePairs: sourcePairs
        .filter((pair) =>
          query.source
            ? pair.leftSourceCode === query.source ||
              pair.rightSourceCode === query.source
            : true,
        )
        .slice(0, query.limit ?? DEFAULT_RECORD_LIMIT)
        .map((pair) =>
          this.toSourcePairOverlapItem(
            pair,
            sourceOverviewByCode.get(pair.leftSourceCode),
            sourceOverviewByCode.get(pair.rightSourceCode),
          ),
        ),
      rejectedByBucket: this.buildRejectedPairBucketCountsFromRescan(
        latestOpportunityRescan?.result,
      ),
    };
  }

  async getMarketStateFreshnessDistribution(
    user: Pick<AuthUserRecord, 'role'>,
  ): Promise<MarketStateFreshnessDistributionDto> {
    this.assertAdminUser(user, 'market state freshness diagnostics');

    const generatedAt = new Date();
    const sourceOverviewRecords =
      await this.diagnosticsRepository.listSourceOverviewRecords();
    const freshnessDistribution = await this.buildFreshnessDistribution(
      sourceOverviewRecords,
      generatedAt,
    );

    return {
      generatedAt,
      overall: freshnessDistribution.overall,
      sources: freshnessDistribution.sources,
    };
  }

  async getUnresolvedMappings(
    query: GetDiagnosticsRecordsQueryDto,
    user: Pick<AuthUserRecord, 'role'>,
  ): Promise<UnresolvedMappingDiagnosticsDto> {
    this.assertAdminUser(user, 'unresolved mapping diagnostics');

    const generatedAt = new Date();
    const lookbackHours = query.lookbackHours ?? DEFAULT_LOOKBACK_HOURS;
    const since = new Date(
      generatedAt.getTime() - lookbackHours * 60 * 60 * 1000,
    );
    const limit = query.limit ?? DEFAULT_RECORD_LIMIT;
    const fetchLimit = Math.max(limit * 6, 100);
    const [pendingMappings, jobRuns, syncStatuses, healthMetrics] =
      await Promise.all([
        this.diagnosticsRepository.listRecentPendingSourceMappings({
          ...(query.source ? { source: query.source } : {}),
          since,
          unresolvedOnly: true,
          limit: Math.min(MAX_UNRESOLVED_SIGNAL_SCAN, fetchLimit),
        }),
        this.diagnosticsRepository.listRecentJobRuns({
          ...(query.source ? { source: query.source } : {}),
          since,
          limit: Math.min(MAX_UNRESOLVED_SIGNAL_SCAN, fetchLimit),
        }),
        this.diagnosticsRepository.listRecentSourceSyncStatuses({
          ...(query.source ? { source: query.source } : {}),
          since,
          limit: Math.min(MAX_UNRESOLVED_SIGNAL_SCAN, fetchLimit),
        }),
        this.diagnosticsRepository.listRecentHealthMetrics({
          ...(query.source ? { source: query.source } : {}),
          since,
          limit: Math.min(MAX_UNRESOLVED_SIGNAL_SCAN, fetchLimit),
        }),
      ]);
    const signals = [
      ...pendingMappings.map((mapping) =>
        this.toUnresolvedSignalFromPendingMapping(mapping),
      ),
      ...jobRuns.flatMap((jobRun) =>
        this.extractUnresolvedSignalsFromJobRun(jobRun),
      ),
      ...syncStatuses.flatMap((syncStatus) =>
        this.extractUnresolvedSignalsFromSyncStatus(syncStatus),
      ),
      ...healthMetrics.flatMap((healthMetric) =>
        this.extractUnresolvedSignalsFromHealthMetric(healthMetric),
      ),
    ];
    const groupedSignals = new Map<
      string,
      {
        source: UnresolvedMappingItemDto['source'];
        sourceName: string;
        occurrences: number;
        firstSeenAt: Date;
        lastSeenAt: Date;
        evidenceKinds: Set<UnresolvedSignalKind>;
        sampleMessage: string;
        itemHint?: string;
      }
    >();

    for (const signal of signals) {
      const groupingKey = `${signal.source}:${signal.itemHint ?? signal.message.toLowerCase()}`;
      const existingSignal = groupedSignals.get(groupingKey);

      if (!existingSignal) {
        groupedSignals.set(groupingKey, {
          source: signal.source,
          sourceName: signal.sourceName,
          occurrences: 1,
          firstSeenAt: signal.detectedAt,
          lastSeenAt: signal.detectedAt,
          evidenceKinds: new Set([signal.evidenceKind]),
          sampleMessage: signal.message,
          ...(signal.itemHint ? { itemHint: signal.itemHint } : {}),
        });
        continue;
      }

      existingSignal.occurrences += 1;
      existingSignal.firstSeenAt =
        existingSignal.firstSeenAt.getTime() <= signal.detectedAt.getTime()
          ? existingSignal.firstSeenAt
          : signal.detectedAt;
      existingSignal.lastSeenAt =
        existingSignal.lastSeenAt.getTime() >= signal.detectedAt.getTime()
          ? existingSignal.lastSeenAt
          : signal.detectedAt;
      existingSignal.evidenceKinds.add(signal.evidenceKind);
    }

    return {
      generatedAt,
      lookbackHours,
      note: 'Pending mappings are first-class backlog records from the ingestion pipeline. Job/sync/health text signals are kept as fallback evidence for parser drift.',
      items: [...groupedSignals.values()]
        .sort((left, right) => {
          if (right.occurrences !== left.occurrences) {
            return right.occurrences - left.occurrences;
          }

          return right.lastSeenAt.getTime() - left.lastSeenAt.getTime();
        })
        .slice(0, limit)
        .map(
          (item): UnresolvedMappingItemDto => ({
            source: item.source,
            sourceName: item.sourceName,
            ...(item.itemHint ? { itemHint: item.itemHint } : {}),
            occurrences: item.occurrences,
            firstSeenAt: item.firstSeenAt,
            lastSeenAt: item.lastSeenAt,
            evidenceKinds: [...item.evidenceKinds],
            sampleMessage: item.sampleMessage,
          }),
        ),
    };
  }

  async getOpportunityRejectReasons(
    query: GetDiagnosticsRejectReasonsQueryDto,
    user: Pick<AuthUserRecord, 'role'>,
  ): Promise<OpportunityRejectReasonsDto> {
    this.assertAdminUser(user, 'opportunity reject diagnostics');

    const engineResult =
      await this.evaluateScannerUniverse({
        ...(query.tier ? { tier: query.tier } : {}),
        ...(query.category ? { category: query.category } : {}),
        limit: query.limit ?? DEFAULT_REJECT_SCAN_LIMIT,
        maxPairsPerItem: query.maxPairsPerItem ?? DEFAULT_REJECT_MAX_PAIRS,
        includeRejected: true,
      });
    const rejectedEvaluations = engineResult.results.flatMap((result) =>
      result.evaluations.filter(
        (evaluation) => evaluation.disposition === 'rejected',
      ),
    );
    const rejectReasonMap = new Map<
      OpportunityReasonCode,
      {
        count: number;
        sampleSourcePairs: Set<string>;
        sampleItems: Set<string>;
      }
    >();

    for (const evaluation of rejectedEvaluations) {
      for (const reasonCode of new Set(evaluation.reasonCodes)) {
        const currentRecord = rejectReasonMap.get(reasonCode) ?? {
          count: 0,
          sampleSourcePairs: new Set<string>(),
          sampleItems: new Set<string>(),
        };

        currentRecord.count += 1;
        currentRecord.sampleSourcePairs.add(evaluation.sourcePairKey);
        currentRecord.sampleItems.add(evaluation.variantDisplayName);
        rejectReasonMap.set(reasonCode, currentRecord);
      }
    }

    return {
      generatedAt: new Date(),
      evaluatedItemCount: engineResult.evaluatedItemCount,
      evaluatedPairCount: engineResult.evaluatedPairCount,
      rejectedPairCount: rejectedEvaluations.length,
      antiFakeCounters: engineResult.antiFakeCounters,
      reasons: [...rejectReasonMap.entries()]
        .map(
          ([reasonCode, details]): OpportunityRejectReasonMetricDto => ({
            reasonCode,
            count: details.count,
            shareOfRejectedPairs:
              rejectedEvaluations.length > 0
                ? this.toPercent(details.count / rejectedEvaluations.length)
                : 0,
            sampleSourcePairs: [...details.sampleSourcePairs].slice(0, 3),
            sampleItems: [...details.sampleItems].slice(0, 3),
          }),
        )
        .sort((left, right) => {
          if (right.count !== left.count) {
            return right.count - left.count;
          }

          return left.reasonCode.localeCompare(right.reasonCode);
        })
        .slice(0, query.top ?? DEFAULT_REJECT_TOP),
    };
  }

  async getJobRunHistory(
    query: GetDiagnosticsRecordsQueryDto,
    user: Pick<AuthUserRecord, 'role'>,
  ): Promise<JobRunHistoryDto> {
    this.assertAdminUser(user, 'job history diagnostics');

    const limit = query.limit ?? DEFAULT_JOB_HISTORY_LIMIT;
    const jobRuns = await this.diagnosticsRepository.listRecentJobRuns({
      ...(query.source ? { source: query.source } : {}),
      ...(query.queueName ? { queueName: query.queueName } : {}),
      limit,
    });

    return {
      generatedAt: new Date(),
      limit,
      items: jobRuns.map((jobRun) => this.toJobRunHistoryItem(jobRun)),
    };
  }

  async getSourceSyncFailures(
    query: GetDiagnosticsRecordsQueryDto,
    user: Pick<AuthUserRecord, 'role'>,
  ): Promise<SourceSyncFailuresDto> {
    this.assertAdminUser(user, 'source sync failure diagnostics');

    const syncStatuses =
      await this.diagnosticsRepository.listRecentSourceSyncStatuses({
        ...(query.source ? { source: query.source } : {}),
        limit: query.limit ?? DEFAULT_RECORD_LIMIT,
        statuses: [SyncStatus.FAILED, SyncStatus.DEGRADED],
      });

    return {
      generatedAt: new Date(),
      items: syncStatuses
        .map((syncStatus) => this.toSourceSyncFailureItem(syncStatus))
        .sort((left, right) => {
          const statusRankDifference =
            this.rankSyncFailureStatus(left.status) -
            this.rankSyncFailureStatus(right.status);

          if (statusRankDifference !== 0) {
            return statusRankDifference;
          }

          if (right.consecutiveFailureCount !== left.consecutiveFailureCount) {
            return right.consecutiveFailureCount - left.consecutiveFailureCount;
          }

          return right.updatedAt.getTime() - left.updatedAt.getTime();
        }),
    };
  }

  private async buildFreshnessDistribution(
    sourceOverviewRecords: readonly DiagnosticsSourceOverviewRecord[],
    now: Date,
  ): Promise<ComputedFreshnessDistribution> {
    const sourceFreshnessItems = await Promise.all(
      sourceOverviewRecords.map(async (sourceRecord) => {
        const freshnessPolicy =
          this.marketFreshnessPolicyService.evaluateSourceState(
            {
              sourceCode: sourceRecord.code,
              sourceKind: sourceRecord.kind,
              sourceMetadata: sourceRecord.metadata,
            },
            now,
            now,
          );
        const staleCutoff = new Date(
          now.getTime() - freshnessPolicy.staleAfterMs,
        );
        const expiredCutoff = new Date(
          now.getTime() - freshnessPolicy.maxStaleMs,
        );
        const [totalItems, freshItems, expiredItems] = await Promise.all([
          this.diagnosticsRepository.countMarketStatesForSource(
            sourceRecord.id,
          ),
          this.diagnosticsRepository.countMarketStatesForSource(
            sourceRecord.id,
            {
              observedAtGte: staleCutoff,
            },
          ),
          this.diagnosticsRepository.countMarketStatesForSource(
            sourceRecord.id,
            {
              observedAtLt: expiredCutoff,
            },
          ),
        ]);
        const staleItems = Math.max(0, totalItems - freshItems - expiredItems);
        const freshness = this.toFreshnessCounts({
          totalItems,
          freshItems,
          staleItems,
          expiredItems,
          ...(sourceRecord.latestMarketStateObservedAt
            ? { lastObservedAt: sourceRecord.latestMarketStateObservedAt }
            : {}),
        });

        return {
          sourceId: sourceRecord.id,
          dto: {
            source: sourceRecord.code,
            sourceName: sourceRecord.name,
            sourceKind: sourceRecord.kind,
            freshness,
          } satisfies MarketStateFreshnessDistributionItemDto,
        };
      }),
    );
    const freshnessBySourceId = new Map(
      sourceFreshnessItems.map((item) => [item.sourceId, item.dto.freshness]),
    );
    const overallTotals = sourceFreshnessItems.reduce(
      (totals, item) => ({
        totalItems: totals.totalItems + item.dto.freshness.totalItems,
        freshItems: totals.freshItems + item.dto.freshness.freshItems,
        staleItems: totals.staleItems + item.dto.freshness.staleItems,
        expiredItems: totals.expiredItems + item.dto.freshness.expiredItems,
        lastObservedAt: this.maxDate(
          totals.lastObservedAt,
          item.dto.freshness.lastObservedAt,
        ),
      }),
      {
        totalItems: 0,
        freshItems: 0,
        staleItems: 0,
        expiredItems: 0,
        lastObservedAt: undefined as Date | undefined,
      },
    );

    return {
      overall: this.toFreshnessCounts({
        totalItems: overallTotals.totalItems,
        freshItems: overallTotals.freshItems,
        staleItems: overallTotals.staleItems,
        expiredItems: overallTotals.expiredItems,
        ...(overallTotals.lastObservedAt
          ? { lastObservedAt: overallTotals.lastObservedAt }
          : {}),
      }),
      sources: sourceFreshnessItems
        .map((item) => item.dto)
        .sort((left, right) => left.sourceName.localeCompare(right.sourceName)),
      freshnessBySourceId,
    };
  }

  private toSourceHealthDashboardItem(
    sourceRecord: DiagnosticsSourceOverviewRecord,
    freshness: DiagnosticsFreshnessCountsDto,
    runtimeState?: Awaited<
      ReturnType<SourceRuntimeGuardService['inspect']>
    >,
  ): SourceHealthDashboardItemDto {
    const latestHealthMetric = sourceRecord.latestHealthMetric;
    const healthStatus = this.resolveHealthStatus(sourceRecord);
    const sourceMetadata = this.toJsonObject(sourceRecord.metadata);
    const operationalMetadata = this.toJsonObject(sourceMetadata.operational);
    const lastSuccessfulSyncAt = this.maxDate(
      ...sourceRecord.syncStatuses.map(
        (syncStatus) => syncStatus.lastSuccessfulAt,
      ),
    );
    const lastFailureAt = this.maxDate(
      ...sourceRecord.syncStatuses.map(
        (syncStatus) => syncStatus.lastFailureAt,
      ),
    );

    return {
      source: sourceRecord.code,
      sourceName: sourceRecord.name,
      sourceKind: sourceRecord.kind,
      isEnabled: sourceRecord.isEnabled,
      ...(typeof operationalMetadata.integrationModel === 'string'
        ? { integrationModel: operationalMetadata.integrationModel }
        : {}),
      ...(typeof operationalMetadata.stage === 'string'
        ? { operationalStage: operationalMetadata.stage }
        : {}),
      ...(runtimeState ? { runtimeState: runtimeState.mode } : {}),
      ...(runtimeState?.reason ? { runtimeReason: runtimeState.reason } : {}),
      requiresProxy: operationalMetadata.proxyRequirement === 'required',
      requiresSession:
        operationalMetadata.sessionRequirement === 'required' ||
        operationalMetadata.cookieRequirement === 'required',
      requiresAccount: operationalMetadata.accountRequirement === 'required',
      healthStatus,
      ...(latestHealthMetric?.recordedAt
        ? { healthCheckedAt: latestHealthMetric.recordedAt }
        : {}),
      ...(latestHealthMetric?.availabilityRatio !== null &&
      latestHealthMetric?.availabilityRatio !== undefined
        ? {
            availabilityRatio: this.toNumber(
              latestHealthMetric.availabilityRatio,
            ),
          }
        : {}),
      ...(latestHealthMetric?.errorRate !== null &&
      latestHealthMetric?.errorRate !== undefined
        ? { errorRate: this.toNumber(latestHealthMetric.errorRate) }
        : {}),
      ...(latestHealthMetric?.latencyP95Ms !== null &&
      latestHealthMetric?.latencyP95Ms !== undefined
        ? { latencyP95Ms: latestHealthMetric.latencyP95Ms }
        : {}),
      ...(latestHealthMetric?.queueDepth !== null &&
      latestHealthMetric?.queueDepth !== undefined
        ? { queueDepth: latestHealthMetric.queueDepth }
        : {}),
      ...(latestHealthMetric?.rateLimitRemaining !== null &&
      latestHealthMetric?.rateLimitRemaining !== undefined
        ? { latestRateLimitRemaining: latestHealthMetric.rateLimitRemaining }
        : {}),
      ...(lastSuccessfulSyncAt ? { lastSuccessfulSyncAt } : {}),
      ...(lastFailureAt ? { lastFailureAt } : {}),
      consecutiveFailures: Math.max(
        0,
        ...sourceRecord.syncStatuses.map(
          (syncStatus) => syncStatus.consecutiveFailureCount,
        ),
      ),
      freshness,
      syncStatuses: sourceRecord.syncStatuses.map((syncStatus) => {
        const errorMessage =
          this.extractDiagnosticMessage(syncStatus.details) ??
          syncStatus.lastJobRun?.errorMessage;

        return {
          syncType: syncStatus.syncType,
          status: syncStatus.status,
          updatedAt: syncStatus.updatedAt,
          ...(syncStatus.lastSuccessfulAt
            ? { lastSuccessfulAt: syncStatus.lastSuccessfulAt }
            : {}),
          ...(syncStatus.lastFailureAt
            ? { lastFailureAt: syncStatus.lastFailureAt }
            : {}),
          consecutiveFailureCount: syncStatus.consecutiveFailureCount,
          ...(errorMessage ? { error: errorMessage } : {}),
          ...(syncStatus.lastJobRun?.id
            ? { lastJobRunId: syncStatus.lastJobRun.id }
            : {}),
        };
      }),
      ...(sourceRecord.latestJobRun
        ? { latestJobRun: this.toJobRunHistoryItem(sourceRecord.latestJobRun) }
        : {}),
    };
  }

  private toUnresolvedSignalFromPendingMapping(
    mapping: DiagnosticsPendingSourceMappingRecord,
  ): UnresolvedSignal {
    const itemHint =
      mapping.normalizedTitle ??
      mapping.title ??
      mapping.sourceItemId;

    return {
      source: mapping.sourceCode,
      sourceName: mapping.sourceName,
      message:
        mapping.resolutionNote?.trim() ||
        `Pending ${mapping.kind.toLowerCase()} mapping in ${mapping.endpointName}.`,
      detectedAt: mapping.observedAt,
      evidenceKind: 'pending-mapping',
      ...(itemHint ? { itemHint } : {}),
    };
  }

  private toSourceSyncFailureItem(
    syncStatus: DiagnosticsSourceSyncStatusRecord,
  ): SourceSyncFailureItemDto {
    const errorMessage =
      this.extractDiagnosticMessage(syncStatus.details) ??
      syncStatus.lastJobRun?.errorMessage;

    return {
      source: syncStatus.sourceCode,
      sourceName: syncStatus.sourceName,
      syncType: syncStatus.syncType,
      status: syncStatus.status,
      updatedAt: syncStatus.updatedAt,
      ...(syncStatus.lastSuccessfulAt
        ? { lastSuccessfulAt: syncStatus.lastSuccessfulAt }
        : {}),
      ...(syncStatus.lastFailureAt
        ? { lastFailureAt: syncStatus.lastFailureAt }
        : {}),
      consecutiveFailureCount: syncStatus.consecutiveFailureCount,
      ...(errorMessage ? { error: errorMessage } : {}),
      ...(syncStatus.lastJobRun
        ? { lastJobRun: this.toJobRunHistoryItem(syncStatus.lastJobRun) }
        : {}),
    };
  }

  private toJobRunHistoryItem(
    jobRun: DiagnosticsJobRunRecord,
  ): DiagnosticsJobRunHistoryItemDto {
    const startedAt = jobRun.startedAt ?? undefined;
    const finishedAt = jobRun.finishedAt ?? undefined;
    const durationMs =
      startedAt && finishedAt
        ? Math.max(0, finishedAt.getTime() - startedAt.getTime())
        : !startedAt && finishedAt
          ? Math.max(0, finishedAt.getTime() - jobRun.queuedAt.getTime())
          : undefined;

    return {
      id: jobRun.id,
      queueName: jobRun.queueName,
      jobType: jobRun.jobType,
      jobName: jobRun.jobName,
      status: jobRun.status,
      queuedAt: jobRun.queuedAt,
      ...(startedAt ? { startedAt } : {}),
      ...(finishedAt ? { finishedAt } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      attempt: jobRun.attempt,
      maxAttempts: jobRun.maxAttempts,
      ...(jobRun.priority !== null && jobRun.priority !== undefined
        ? { priority: jobRun.priority }
        : {}),
      ...(jobRun.sourceCode ? { source: jobRun.sourceCode } : {}),
      ...(jobRun.sourceName ? { sourceName: jobRun.sourceName } : {}),
      ...(jobRun.errorMessage ? { errorMessage: jobRun.errorMessage } : {}),
    };
  }

  private extractUnresolvedSignalsFromJobRun(
    jobRun: DiagnosticsJobRunRecord,
  ): readonly UnresolvedSignal[] {
    if (!jobRun.sourceCode || !jobRun.sourceName) {
      return [];
    }

    return this.extractUnresolvedSignals(
      [
        ...(jobRun.errorMessage ? [jobRun.errorMessage] : []),
        ...this.extractStringFragments(jobRun.result),
        ...this.extractStringFragments(jobRun.payload),
      ],
      {
        source: jobRun.sourceCode,
        sourceName: jobRun.sourceName,
        detectedAt: jobRun.updatedAt,
        evidenceKind: 'job-run',
      },
    );
  }

  private extractUnresolvedSignalsFromSyncStatus(
    syncStatus: DiagnosticsSourceSyncStatusRecord,
  ): readonly UnresolvedSignal[] {
    return this.extractUnresolvedSignals(
      [
        ...this.extractStringFragments(syncStatus.details),
        ...this.extractStringFragments(syncStatus.cursor),
        ...(syncStatus.lastJobRun?.errorMessage
          ? [syncStatus.lastJobRun.errorMessage]
          : []),
      ],
      {
        source: syncStatus.sourceCode,
        sourceName: syncStatus.sourceName,
        detectedAt: syncStatus.updatedAt,
        evidenceKind: 'sync-status',
      },
    );
  }

  private extractUnresolvedSignalsFromHealthMetric(
    healthMetric: DiagnosticsHealthMetricWithSourceRecord,
  ): readonly UnresolvedSignal[] {
    return this.extractUnresolvedSignals(
      this.extractStringFragments(healthMetric.details),
      {
        source: healthMetric.sourceCode,
        sourceName: healthMetric.sourceName,
        detectedAt: healthMetric.recordedAt,
        evidenceKind: 'health-metric',
      },
    );
  }

  private extractUnresolvedSignals(
    fragments: readonly string[],
    context: Omit<UnresolvedSignal, 'message' | 'itemHint'>,
  ): readonly UnresolvedSignal[] {
    const dedupedMessages = [
      ...new Set(fragments.map((fragment) => fragment.trim())),
    ]
      .filter((fragment) => fragment.length > 0)
      .filter((fragment) =>
        /\bunresolved\b|catalog resolver left/i.test(fragment),
      );
    return dedupedMessages.map((message) => {
      const itemHint = this.extractQuotedItemHint(message);

      return {
        ...context,
        message,
        ...(itemHint ? { itemHint } : {}),
      };
    });
  }

  private extractQuotedItemHint(message: string): string | undefined {
    const matchedItem = message.match(/"([^"]+)"/);

    return matchedItem?.[1]?.trim() || undefined;
  }

  private extractStringFragments(value: unknown, depth = 0): string[] {
    if (value === null || value === undefined || depth > 6) {
      return [];
    }

    if (typeof value === 'string') {
      return [value];
    }

    if (Array.isArray(value)) {
      return value.flatMap((entry) =>
        this.extractStringFragments(entry, depth + 1),
      );
    }

    if (typeof value === 'object') {
      return Object.values(value as Record<string, unknown>).flatMap((entry) =>
        this.extractStringFragments(entry, depth + 1),
      );
    }

    return [];
  }

  private extractDiagnosticMessage(value: unknown): string | undefined {
    if (!value) {
      return undefined;
    }

    if (typeof value === 'string') {
      return value.trim() || undefined;
    }

    if (Array.isArray(value) && typeof value[0] === 'string') {
      return value[0].trim() || undefined;
    }

    if (typeof value !== 'object') {
      return undefined;
    }

    const record = value as Record<string, unknown>;

    for (const key of ['error', 'reason', 'message']) {
      const recordValue = record[key];

      if (typeof recordValue === 'string' && recordValue.trim().length > 0) {
        return recordValue.trim();
      }
    }

    if (Array.isArray(record.warnings)) {
      const warning = record.warnings.find(
        (entry): entry is string =>
          typeof entry === 'string' && entry.trim().length > 0,
      );

      if (warning) {
        return warning.trim();
      }
    }

    return this.extractStringFragments(value)[0]?.trim() || undefined;
  }

  private toSourceCountMap(
    records: readonly {
      readonly sourceCode: RateLimitBurnMetricDto['source'];
      readonly count: number;
    }[],
  ): ReadonlyMap<RateLimitBurnMetricDto['source'], number> {
    return new Map(
      records.map((record) => [record.sourceCode, record.count] as const),
    );
  }

  private toSourceTimestampMap(
    records: readonly {
      readonly sourceCode: RateLimitBurnMetricDto['source'];
      readonly timestamp: Date;
    }[],
  ): ReadonlyMap<RateLimitBurnMetricDto['source'], Date> {
    return new Map(
      records.map((record) => [record.sourceCode, record.timestamp] as const),
    );
  }

  private toSourceEndpointTimestampMap(
    records: readonly {
      readonly sourceCode: RateLimitBurnMetricDto['source'];
      readonly endpointName: string;
      readonly latestObservedAt: Date;
    }[],
  ): ReadonlyMap<
    RateLimitBurnMetricDto['source'],
    ReadonlyMap<string, Date>
  > {
    const recordsBySource = new Map<
      RateLimitBurnMetricDto['source'],
      Map<string, Date>
    >();

    for (const record of records) {
      const endpointMap =
        recordsBySource.get(record.sourceCode) ?? new Map<string, Date>();

      endpointMap.set(record.endpointName, record.latestObservedAt);
      recordsBySource.set(record.sourceCode, endpointMap);
    }

    return new Map(
      [...recordsBySource.entries()].map(([sourceCode, endpointMap]) => [
        sourceCode,
        endpointMap,
      ]),
    );
  }

  private resolveLatestStateCapableRawObservedAt(
    source: RateLimitBurnMetricDto['source'],
    endpointTimestamps?: ReadonlyMap<string, Date>,
  ): Date | undefined {
    if (!endpointTimestamps) {
      return undefined;
    }

    return this.maxDate(
      ...this.getStateCapableRawEndpoints(source).map((endpointName) =>
        endpointTimestamps.get(endpointName),
      ),
    );
  }

  private getStateCapableRawEndpoints(
    source: RateLimitBurnMetricDto['source'],
  ): readonly string[] {
    switch (source) {
      case 'skinport':
        return ['skinport-items-snapshot', 'skinport-sales-history'];
      case 'csfloat':
        return ['csfloat-listings', 'csfloat-listing-detail'];
      case 'dmarket':
        return ['dmarket-market-items'];
      case 'waxpeer':
        return ['waxpeer-mass-info'];
      case 'steam-snapshot':
        return ['steam-snapshot-priceoverview-batch'];
      case 'backup-aggregator':
        return ['provider-managed'];
      case 'bitskins':
        return ['bitskins-listings'];
      case 'youpin':
        return ['youpin-listings'];
      case 'c5game':
        return ['c5game-listings'];
      case 'csmoney':
        return ['csmoney-listings'];
    }
  }

  private toRatio(numerator: number, denominator: number): number {
    return Number((numerator / Math.max(1, denominator)).toFixed(2));
  }

  private buildOverlapSummaryBySource(
    pairs: readonly DiagnosticsSourcePairOverlapRecord[],
  ): ReadonlyMap<
    SourceAdapterKey,
    {
      readonly canonicalOverlapVariantCount: number;
      readonly pairableOverlapVariantCount: number;
      readonly blockedOverlapVariantCount: number;
      readonly averageOverlapQualityScore?: number;
    }
  > {
    const aggregates = new Map<
      SourceAdapterKey,
      {
        canonicalOverlapVariantCount: number;
        pairableOverlapVariantCount: number;
        blockedOverlapVariantCount: number;
        overlapQualityScoreTotal: number;
        overlapQualityScoreCount: number;
      }
    >();

    for (const pair of pairs) {
      for (const source of [pair.leftSourceCode, pair.rightSourceCode]) {
        const current = aggregates.get(source) ?? {
          canonicalOverlapVariantCount: 0,
          pairableOverlapVariantCount: 0,
          blockedOverlapVariantCount: 0,
          overlapQualityScoreTotal: 0,
          overlapQualityScoreCount: 0,
        };

        current.canonicalOverlapVariantCount += pair.canonicalOverlapCount;
        current.pairableOverlapVariantCount += pair.pairableVariantCount;
        current.blockedOverlapVariantCount += pair.blockedVariantCount;

        if (pair.canonicalOverlapCount > 0) {
          current.overlapQualityScoreTotal += pair.overlapQualityScore;
          current.overlapQualityScoreCount += 1;
        }

        aggregates.set(source, current);
      }
    }

    return new Map(
      [...aggregates.entries()].map(([source, aggregate]) => [
        source,
        {
          canonicalOverlapVariantCount: aggregate.canonicalOverlapVariantCount,
          pairableOverlapVariantCount: aggregate.pairableOverlapVariantCount,
          blockedOverlapVariantCount: aggregate.blockedOverlapVariantCount,
          ...(aggregate.overlapQualityScoreCount > 0
            ? {
                averageOverlapQualityScore: Number(
                  (
                    aggregate.overlapQualityScoreTotal /
                    aggregate.overlapQualityScoreCount
                  ).toFixed(4),
                ),
              }
            : {}),
        },
      ]),
    );
  }

  private toSourcePairOverlapItem(
    pair: DiagnosticsSourcePairOverlapRecord,
    leftSourceOverview?: DiagnosticsSourceOverviewRecord,
    rightSourceOverview?: DiagnosticsSourceOverviewRecord,
  ): SourcePairOverlapSummaryDto['pairableSourcePairs'][number] {
    const leftMetadata = this.toJsonObject(
      leftSourceOverview?.metadata ?? null,
    );
    const rightMetadata = this.toJsonObject(
      rightSourceOverview?.metadata ?? null,
    );
    const leftBehavior = this.readBehaviorFlags(leftMetadata);
    const rightBehavior = this.readBehaviorFlags(rightMetadata);
    const leftClassification =
      typeof leftMetadata.classification === 'string'
        ? leftMetadata.classification
        : undefined;
    const rightClassification =
      typeof rightMetadata.classification === 'string'
        ? rightMetadata.classification
        : undefined;
    const pairBuildingAllowed =
      leftBehavior.canBeUsedForPairBuilding !== false &&
      rightBehavior.canBeUsedForPairBuilding !== false;
    const pairPolicy = !pairBuildingAllowed
      ? 'confirmation-only'
      : leftClassification === 'OPTIONAL' ||
          leftClassification === 'FRAGILE' ||
          rightClassification === 'OPTIONAL' ||
          rightClassification === 'FRAGILE'
        ? 'penalized'
        : 'standard';

    return {
      leftSource: pair.leftSourceCode,
      leftSourceName: pair.leftSourceName,
      rightSource: pair.rightSourceCode,
      rightSourceName: pair.rightSourceName,
      canonicalOverlapCount: pair.canonicalOverlapCount,
      pairableVariantCount: pair.pairableVariantCount,
      blockedVariantCount: pair.blockedVariantCount,
      overlapQualityScore: pair.overlapQualityScore,
      pairBuildingAllowed,
      pairPolicy,
    };
  }

  private readBehaviorFlags(
    value: Readonly<Record<string, unknown>>,
  ): Readonly<Record<string, boolean>> {
    const behavior =
      value.behavior &&
      typeof value.behavior === 'object' &&
      !Array.isArray(value.behavior)
        ? (value.behavior as Record<string, unknown>)
        : {};

    return {
      canDrivePrimaryTruth:
        typeof behavior.canDrivePrimaryTruth === 'boolean'
          ? behavior.canDrivePrimaryTruth
          : false,
      canProvideFallbackPricing:
        typeof behavior.canProvideFallbackPricing === 'boolean'
          ? behavior.canProvideFallbackPricing
          : false,
      canProvideQuantitySignals:
        typeof behavior.canProvideQuantitySignals === 'boolean'
          ? behavior.canProvideQuantitySignals
          : false,
      canBeUsedForPairBuilding:
        typeof behavior.canBeUsedForPairBuilding === 'boolean'
          ? behavior.canBeUsedForPairBuilding
          : false,
      canBeUsedForConfirmationOnly:
        typeof behavior.canBeUsedForConfirmationOnly === 'boolean'
          ? behavior.canBeUsedForConfirmationOnly
          : false,
    };
  }

  private buildRejectedPairBucketCounts(
    engineResult: OpportunityEngineScanResultDto,
  ): PairRejectionBucketCountsDto {
    const sourcePolicyReasons = new Set<OpportunityReasonCode>([
      'buy_sell_same_source',
      'sell_source_has_no_exit_signal',
      'sell_source_requires_listed_exit',
    ]);
    const confidenceReasons = new Set<OpportunityReasonCode>([
      'confidence_below_candidate_floor',
      'confidence_below_eligible_floor',
      'LOW_SOURCE_CONFIDENCE',
      'LOW_MATCH_CONFIDENCE',
    ]);
    const freshnessReasons = new Set<OpportunityReasonCode>([
      'freshness_penalty_elevated',
      'stale_penalty_elevated',
      'steam_snapshot_fallback_used',
      'stale_snapshot_used',
      'STALE_SOURCE_STATE',
    ]);
    const categoryReasonCodes = new Set<OpportunityReasonCode>([
      'expected_net_below_category_floor',
      'spread_percent_below_category_floor',
      'category_penalty_elevated',
    ]);
    const counts = {
      sourcePolicy: 0,
      confidence: 0,
      freshness: 0,
      missingAsk: 0,
      categoryRules: 0,
    };

    for (const result of engineResult.results) {
      for (const evaluation of result.evaluations) {
        if (evaluation.disposition !== 'rejected') {
          continue;
        }

        const reasonCodes = new Set(evaluation.reasonCodes);

        if (
          [...sourcePolicyReasons].some((reasonCode) =>
            reasonCodes.has(reasonCode),
          )
        ) {
          counts.sourcePolicy += 1;
        }

        if (
          [...confidenceReasons].some((reasonCode) =>
            reasonCodes.has(reasonCode),
          )
        ) {
          counts.confidence += 1;
        }

        if (
          [...freshnessReasons].some((reasonCode) =>
            reasonCodes.has(reasonCode),
          )
        ) {
          counts.freshness += 1;
        }

        if (reasonCodes.has('buy_source_has_no_ask')) {
          counts.missingAsk += 1;
        }

        if (
          [...categoryReasonCodes].some((reasonCode) =>
            reasonCodes.has(reasonCode),
          )
        ) {
          counts.categoryRules += 1;
        }
      }
    }

    return counts;
  }

  private buildRejectedPairBucketCountsFromRescan(
    value: unknown,
  ): PairRejectionBucketCountsDto {
    const result = this.toJsonObject(value);
    const pairFunnel = this.toJsonObject(result.pairFunnel);

    return {
      sourcePolicy:
        (this.readNumber(pairFunnel.sellSourceHasNoExitSignal) ?? 0) +
        (this.readNumber(pairFunnel.listedExitOnly) ?? 0),
      confidence:
        this.readNumber(pairFunnel.confidenceBelowCandidateFloor) ?? 0,
      freshness: this.readNumber(pairFunnel.preScoreRejected) ?? 0,
      missingAsk: this.readNumber(pairFunnel.buySourceHasNoAsk) ?? 0,
      categoryRules:
        (this.readNumber(pairFunnel.trueNonPositiveEdge) ??
          this.readNumber(pairFunnel.negativeExpectedNet)) ??
        0,
    };
  }

  private async evaluateScannerUniverse(input: {
    readonly tier?: 'hot' | 'warm' | 'cold';
    readonly category?: Parameters<
      ScannerUniverseService['getScannerUniverse']
    >[0] extends infer T
      ? T extends { category?: infer C }
        ? C
        : never
      : never;
    readonly limit: number;
    readonly maxPairsPerItem: number;
    readonly includeRejected: boolean;
  }): Promise<OpportunityEngineScanResultDto> {
    const universe = await this.scannerUniverseService.getScannerUniverse({
      ...(input.tier ? { tier: input.tier } : {}),
      ...(input.category ? { category: input.category } : {}),
      limit: input.limit,
    });

    return this.opportunityEngineService.evaluateVariants({
      itemVariantIds: universe.items.map((item) => item.itemVariantId),
      includeRejected: input.includeRejected,
      maxPairs: input.maxPairsPerItem,
    });
  }

  private getQueueOutcomeCount(
    records: readonly {
      readonly queueName: string;
      readonly status: JobRunStatus;
      readonly count: number;
    }[],
    queueName: string,
    status: JobRunStatus,
  ): number {
    return (
      records.find(
        (record) => record.queueName === queueName && record.status === status,
      )?.count ?? 0
    );
  }

  private getRateLimitDefinitions(
    source?: RateLimitBurnMetricDto['source'],
  ): readonly RateLimitDefinition[] {
    const definitions: readonly RateLimitDefinition[] = [
      {
        source: 'skinport',
        endpointName: 'skinport-items-snapshot',
        windowLimit: this.configService.skinportRateLimitMaxRequests,
        note: 'Skinport is treated as a slow cached batch source.',
      },
      {
        source: 'skinport',
        endpointName: 'skinport-sales-history',
        windowLimit: this.configService.skinportRateLimitMaxRequests,
        note: 'Shares the same cached endpoint budget as Skinport snapshots.',
      },
      {
        source: 'csfloat',
        endpointName: 'csfloat-listings',
        windowLimit: this.configService.csfloatListingsRateLimitMaxRequests,
        note: 'Primary listings pagination budget.',
      },
      {
        source: 'csfloat',
        endpointName: 'csfloat-listing-detail',
        windowLimit: this.configService.csfloatDetailRateLimitMaxRequests,
        note: 'Detail fetch budget; used only when listing data is incomplete.',
      },
      {
        source: 'dmarket',
        endpointName: 'dmarket-market-items',
        windowLimit: this.configService.dmarketRateLimitMaxRequests,
        note: 'Signed DMarket title-targeted market-items budget.',
      },
      {
        source: 'waxpeer',
        endpointName: 'waxpeer-mass-info',
        windowLimit: this.configService.waxpeerRateLimitMaxRequests,
        note: 'Official Waxpeer mass-info batch budget shared with search endpoints.',
      },
      {
        source: 'bitskins',
        endpointName: 'bitskins-listings',
        windowLimit: this.configService.bitskinsRateLimitMaxRequests,
        note: 'BitSkins bounded full-snapshot target-filter budget.',
      },
      {
        source: 'youpin',
        endpointName: 'youpin-listings',
        windowLimit: this.configService.youpinRateLimitMaxRequests,
        note: this.configService.youpinReferenceOnly
          ? 'YouPin is running in reference-only mode.'
          : 'YouPin direct market snapshot budget.',
      },
      {
        source: 'c5game',
        endpointName: 'c5game-listings',
        windowLimit: this.configService.c5gameRateLimitMaxRequests,
        note: 'Optional C5Game overlap-first budget.',
      },
      {
        source: 'csmoney',
        endpointName: 'csmoney-listings',
        windowLimit: this.configService.csmoneyRateLimitMaxRequests,
        note: 'Fragile CS.MONEY budget with circuit-breaker protection.',
      },
      {
        source: 'steam-snapshot',
        endpointName: 'steam-snapshot-priceoverview-batch',
        windowLimit: this.configService.steamSnapshotRateLimitMaxRequests,
        note: 'Snapshot-only Steam budget. The scanner reads cached internal state only.',
      },
      {
        source: 'backup-aggregator',
        endpointName: 'provider-managed',
        note: 'Backup providers manage their own budgets. No unified table-backed remaining counter is persisted yet.',
      },
    ];

    return source
      ? definitions.filter((definition) => definition.source === source)
      : definitions;
  }

  private toRateLimitBurnMetric(
    definition: RateLimitDefinition,
    latestMetricByKey: ReadonlyMap<
      string,
      DiagnosticsHealthMetricWithSourceRecord
    >,
  ): RateLimitBurnMetricDto {
    const matchedMetric =
      latestMetricByKey.get(
        `${definition.source}:${definition.endpointName}`,
      ) ?? latestMetricByKey.get(`${definition.source}:source`);
    const retryAfterSeconds = matchedMetric?.details
      ? this.readNumberProperty(matchedMetric.details, 'retryAfterSeconds')
      : undefined;
    const windowRemaining =
      matchedMetric?.rateLimitRemaining !== null &&
      matchedMetric?.rateLimitRemaining !== undefined
        ? matchedMetric.rateLimitRemaining
        : undefined;

    return {
      source: definition.source,
      endpointName: definition.endpointName,
      status: this.resolveRateLimitStatus(
        definition.windowLimit,
        windowRemaining,
        retryAfterSeconds,
      ),
      ...(matchedMetric ? { recordedAt: matchedMetric.recordedAt } : {}),
      ...(definition.windowLimit !== undefined
        ? { windowLimit: definition.windowLimit }
        : {}),
      ...(windowRemaining !== undefined ? { windowRemaining } : {}),
      ...(definition.windowLimit !== undefined && windowRemaining !== undefined
        ? {
            burnPercent: this.toPercent(
              (definition.windowLimit - windowRemaining) /
                Math.max(1, definition.windowLimit),
            ),
          }
        : {}),
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      ...(definition.note ? { note: definition.note } : {}),
    };
  }

  private resolveRateLimitStatus(
    windowLimit?: number,
    windowRemaining?: number,
    retryAfterSeconds?: number,
  ): RateLimitBurnMetricDto['status'] {
    if (windowLimit === undefined || windowRemaining === undefined) {
      return 'unknown';
    }

    if (windowRemaining <= 0 || retryAfterSeconds !== undefined) {
      return 'cooldown';
    }

    return windowRemaining / Math.max(1, windowLimit) <= 0.2
      ? 'limited'
      : 'available';
  }

  private extractEndpointName(
    value: Prisma.JsonValue | null,
  ): string | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    const endpointName = (value as Record<string, unknown>).endpointName;

    return typeof endpointName === 'string' && endpointName.trim().length > 0
      ? endpointName.trim()
      : undefined;
  }

  private readNumberProperty(value: unknown, propertyName: string): number | undefined {
    const record = this.toJsonObject(value);

    return this.readNumber(record[propertyName]);
  }

  private readNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsedValue = Number(value);

      return Number.isFinite(parsedValue) ? parsedValue : undefined;
    }

    return undefined;
  }

  private toJsonObject(value: unknown): Readonly<Record<string, unknown>> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private resolveHealthStatus(
    sourceRecord: DiagnosticsSourceOverviewRecord,
  ): SourceHealthDashboardItemDto['healthStatus'] {
    if (sourceRecord.latestHealthMetric) {
      return sourceRecord.latestHealthMetric.status;
    }

    if (
      sourceRecord.syncStatuses.some(
        (syncStatus) => syncStatus.status === SyncStatus.FAILED,
      )
    ) {
      return HealthStatus.FAILED;
    }

    if (
      sourceRecord.syncStatuses.some(
        (syncStatus) =>
          syncStatus.status === SyncStatus.DEGRADED ||
          syncStatus.consecutiveFailureCount > 0,
      )
    ) {
      return HealthStatus.DEGRADED;
    }

    return 'UNKNOWN';
  }

  private rankSourceHealthStatus(
    healthStatus: SourceHealthDashboardItemDto['healthStatus'],
  ): number {
    switch (healthStatus) {
      case 'FAILED':
        return 0;
      case 'DEGRADED':
        return 1;
      case 'UNKNOWN':
        return 2;
      case 'OK':
        return 3;
    }
  }

  private compareSourceHealthItems(
    left: SourceHealthDashboardItemDto,
    right: SourceHealthDashboardItemDto,
  ): number {
    const statusRankDifference =
      this.rankSourceHealthStatus(left.healthStatus) -
      this.rankSourceHealthStatus(right.healthStatus);

    if (statusRankDifference !== 0) {
      return statusRankDifference;
    }

    if (right.freshness.stalePercent !== left.freshness.stalePercent) {
      return right.freshness.stalePercent - left.freshness.stalePercent;
    }

    return left.sourceName.localeCompare(right.sourceName);
  }

  private rankSyncFailureStatus(status: SyncStatus): number {
    switch (status) {
      case SyncStatus.FAILED:
        return 0;
      case SyncStatus.DEGRADED:
        return 1;
      case SyncStatus.RUNNING:
        return 2;
      case SyncStatus.PAUSED:
        return 3;
      case SyncStatus.IDLE:
        return 4;
      case SyncStatus.SUCCEEDED:
        return 5;
    }
  }

  private toFreshnessCounts(input: {
    readonly totalItems: number;
    readonly freshItems: number;
    readonly staleItems: number;
    readonly expiredItems: number;
    readonly lastObservedAt?: Date;
  }): DiagnosticsFreshnessCountsDto {
    return {
      totalItems: input.totalItems,
      freshItems: input.freshItems,
      staleItems: input.staleItems,
      expiredItems: input.expiredItems,
      freshPercent:
        input.totalItems > 0
          ? this.toPercent(input.freshItems / input.totalItems)
          : 0,
      stalePercent:
        input.totalItems > 0
          ? this.toPercent(input.staleItems / input.totalItems)
          : 0,
      expiredPercent:
        input.totalItems > 0
          ? this.toPercent(input.expiredItems / input.totalItems)
          : 0,
      ...(input.lastObservedAt ? { lastObservedAt: input.lastObservedAt } : {}),
    };
  }

  private createEmptyFreshnessCounts(): DiagnosticsFreshnessCountsDto {
    return {
      totalItems: 0,
      freshItems: 0,
      staleItems: 0,
      expiredItems: 0,
      freshPercent: 0,
      stalePercent: 0,
      expiredPercent: 0,
    };
  }

  private maxDate(...values: (Date | null | undefined)[]): Date | undefined {
    const dates = values.filter(
      (value): value is Date => value instanceof Date,
    );

    if (dates.length === 0) {
      return undefined;
    }

    return [...dates].sort(
      (left, right) => right.getTime() - left.getTime(),
    )[0];
  }

  private toNumber(value: { toString(): string }): number {
    return Number(value.toString());
  }

  private toPercent(value: number): number {
    return Number((Math.max(0, value) * 100).toFixed(2));
  }

  private assertAdminUser(
    user: Pick<AuthUserRecord, 'role'>,
    context: string,
  ): void {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        `Administrator role is required for ${context}.`,
      );
    }
  }
}
