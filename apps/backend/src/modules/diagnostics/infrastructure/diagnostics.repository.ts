import { JobRunStatus, type Prisma, type SyncStatus } from '@prisma/client';
import { IngestionJobStatus, ListingStatus } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  DiagnosticsOverlapCoverageRecord,
  DiagnosticsCsFloatCoverageRecord,
  DiagnosticsHealthMetricWithSourceRecord,
  DiagnosticsJobRunRecord,
  DiagnosticsLatestOpportunityRescanRecord,
  DiagnosticsPendingSourceMappingRecord,
  DiagnosticsRawPayloadEndpointRecord,
  DiagnosticsQueueStatusRecord,
  DiagnosticsRepository,
  DiagnosticsSourceEntityCountRecord,
  DiagnosticsSourceHealthMetricRecord,
  DiagnosticsSourceOverviewRecord,
  DiagnosticsSourcePairOverlapRecord,
  DiagnosticsSourceSyncStatusRecord,
  DiagnosticsSourceTimestampRecord,
} from '../domain/diagnostics.repository';
import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';
import { UPDATE_MARKET_STATE_QUEUE_NAME } from '../../source-adapters/domain/source-ingestion.constants';

@Injectable()
export class DiagnosticsRepositoryAdapter implements DiagnosticsRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
  ) {}

  async listSourceOverviewRecords(): Promise<
    readonly DiagnosticsSourceOverviewRecord[]
  > {
    const sources = await this.prismaService.source.findMany({
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
      include: {
        sourceHealthMetrics: {
          take: 1,
          orderBy: {
            recordedAt: 'desc',
          },
        },
        sourceSyncStatuses: {
          include: {
            source: {
              select: {
                code: true,
                name: true,
              },
            },
            lastJobRun: {
              include: {
                source: {
                  select: {
                    code: true,
                    name: true,
                  },
                },
              },
            },
          },
          orderBy: [{ updatedAt: 'desc' }],
        },
        jobRuns: {
          take: 1,
          orderBy: {
            createdAt: 'desc',
          },
          include: {
            source: {
              select: {
                code: true,
                name: true,
              },
            },
          },
        },
        marketStates: {
          take: 1,
          select: {
            observedAt: true,
          },
          orderBy: {
            observedAt: 'desc',
          },
        },
        rawPayloadArchives: {
          take: 1,
          select: {
            observedAt: true,
          },
          orderBy: {
            observedAt: 'desc',
          },
        },
      },
    });

    return sources.map((source) => ({
      id: source.id,
      code: source.code as SourceAdapterKey,
      name: source.name,
      kind: source.kind,
      isEnabled: source.isEnabled,
      metadata: source.metadata,
      ...(source.sourceHealthMetrics[0]
        ? {
            latestHealthMetric: this.toHealthMetricRecord(
              source.sourceHealthMetrics[0],
            ),
          }
        : {}),
      syncStatuses: source.sourceSyncStatuses.map((syncStatus) =>
        this.toSyncStatusRecord(syncStatus),
      ),
      ...(source.jobRuns[0]
        ? { latestJobRun: this.toJobRunRecord(source.jobRuns[0]) }
        : {}),
      ...(source.rawPayloadArchives[0]?.observedAt
        ? { latestRawPayloadObservedAt: source.rawPayloadArchives[0].observedAt }
        : {}),
      ...(source.marketStates[0]?.observedAt
        ? { latestMarketStateObservedAt: source.marketStates[0].observedAt }
        : {}),
    }));
  }

  countMarketStatesForSource(
    sourceId: string,
    filters?: {
      readonly observedAtGte?: Date;
      readonly observedAtLt?: Date;
    },
  ): Promise<number> {
    return this.prismaService.marketState.count({
      where: {
        sourceId,
        ...(filters?.observedAtGte || filters?.observedAtLt
          ? {
              observedAt: {
                ...(filters.observedAtGte
                  ? { gte: filters.observedAtGte }
                  : {}),
                ...(filters.observedAtLt ? { lt: filters.observedAtLt } : {}),
              },
            }
          : {}),
      },
    });
  }

  async listCurrentQueueLagRecords(): Promise<
    readonly DiagnosticsQueueStatusRecord[]
  > {
    const groups = await this.prismaService.jobRun.groupBy({
      by: ['queueName', 'status'],
      where: {
        status: {
          in: [JobRunStatus.QUEUED, JobRunStatus.RUNNING],
        },
      },
      _count: {
        _all: true,
      },
      _min: {
        queuedAt: true,
        startedAt: true,
      },
    });

    return groups.map((group) => ({
      queueName: group.queueName,
      status: group.status,
      count: group._count._all,
      ...(group._min.queuedAt ? { minQueuedAt: group._min.queuedAt } : {}),
      ...(group._min.startedAt ? { minStartedAt: group._min.startedAt } : {}),
    }));
  }

  async listQueueOutcomeRecords(
    since: Date,
  ): Promise<readonly DiagnosticsQueueStatusRecord[]> {
    const groups = await this.prismaService.jobRun.groupBy({
      by: ['queueName', 'status'],
      where: {
        status: {
          in: [
            JobRunStatus.SUCCEEDED,
            JobRunStatus.FAILED,
            JobRunStatus.CANCELED,
          ],
        },
        finishedAt: {
          gte: since,
        },
      },
      _count: {
        _all: true,
      },
    });

    return groups.map((group) => ({
      queueName: group.queueName,
      status: group.status,
      count: group._count._all,
    }));
  }

  async listSourceListingCounts(): Promise<
    readonly DiagnosticsSourceEntityCountRecord[]
  > {
    const groups = await this.prismaService.sourceListing.groupBy({
      by: ['sourceId'],
      _count: {
        _all: true,
      },
    });

    return this.mapGroupedSourceCounts(groups);
  }

  async listMarketSnapshotCounts(): Promise<
    readonly DiagnosticsSourceEntityCountRecord[]
  > {
    const groups = await this.prismaService.marketSnapshot.groupBy({
      by: ['sourceId'],
      _count: {
        _all: true,
      },
    });

    return this.mapGroupedSourceCounts(groups);
  }

  async listRawPayloadArchiveCounts(): Promise<
    readonly DiagnosticsSourceEntityCountRecord[]
  > {
    const groups = await this.prismaService.rawPayloadArchive.groupBy({
      by: ['sourceId'],
      _count: {
        _all: true,
      },
    });

    return this.mapGroupedSourceCounts(groups);
  }

  async listSourceMarketFactCounts(): Promise<
    readonly DiagnosticsSourceEntityCountRecord[]
  > {
    const groups = await this.prismaService.sourceMarketFact.groupBy({
      by: ['sourceId'],
      _count: {
        _all: true,
      },
    });

    return this.mapGroupedSourceCounts(groups);
  }

  async listMarketStateCounts(): Promise<
    readonly DiagnosticsSourceEntityCountRecord[]
  > {
    const groups = await this.prismaService.marketState.groupBy({
      by: ['sourceId'],
      _count: {
        _all: true,
      },
    });

    return this.mapGroupedSourceCounts(groups);
  }

  async listPendingSourceMappingCounts(query?: {
    readonly source?: SourceAdapterKey;
    readonly unresolvedOnly?: boolean;
  }): Promise<readonly DiagnosticsSourceEntityCountRecord[]> {
    const groups = await this.prismaService.pendingSourceMapping.groupBy({
      by: ['sourceId'],
      where: {
        ...(query?.source ? { source: { code: query.source } } : {}),
        ...(query?.unresolvedOnly ? { resolvedAt: null } : {}),
      },
      _count: {
        _all: true,
      },
    });

    return this.mapGroupedSourceCounts(groups);
  }

  async listUsefulRawPayloadCounts(): Promise<
    readonly DiagnosticsSourceEntityCountRecord[]
  > {
    const rows = await this.prismaService.$queryRaw<
      {
        sourceId: string;
        sourceCode: string;
        sourceName: string;
        count: bigint | number;
      }[]
    >`
      WITH useful_archives AS (
        SELECT DISTINCT "sourceId", "rawPayloadArchiveId"
        FROM "SourceEntityProvenance"
        UNION
        SELECT DISTINCT "sourceId", "rawPayloadArchiveId"
        FROM "SourceMarketFact"
        UNION
        SELECT DISTINCT "sourceId", "rawPayloadArchiveId"
        FROM "PendingSourceMapping"
        UNION
        SELECT DISTINCT "sourceId", "rawPayloadArchiveId"
        FROM "MarketSnapshot"
        WHERE "rawPayloadArchiveId" IS NOT NULL
      )
      SELECT
        s.id AS "sourceId",
        s.code AS "sourceCode",
        s.name AS "sourceName",
        COUNT(*) AS "count"
      FROM useful_archives ua
      JOIN "Source" s ON s.id = ua."sourceId"
      GROUP BY s.id, s.code, s.name
    `;

    return rows.map((row) => ({
      sourceId: row.sourceId,
      sourceCode: row.sourceCode as SourceAdapterKey,
      sourceName: row.sourceName,
      count: this.normalizeCount(row.count),
    }));
  }

  async listRecentRawPayloadArchiveCounts(
    limitPerSource: number,
  ): Promise<readonly DiagnosticsSourceEntityCountRecord[]> {
    const rows = await this.prismaService.$queryRaw<
      {
        sourceId: string;
        sourceCode: string;
        sourceName: string;
        count: bigint | number;
      }[]
    >`
      WITH ranked_archives AS (
        SELECT
          r.id,
          r."sourceId",
          ROW_NUMBER() OVER (
            PARTITION BY r."sourceId"
            ORDER BY r."observedAt" DESC, r."archivedAt" DESC, r.id DESC
          ) AS row_number
        FROM "RawPayloadArchive" r
      )
      SELECT
        s.id AS "sourceId",
        s.code AS "sourceCode",
        s.name AS "sourceName",
        COUNT(*) AS "count"
      FROM ranked_archives ra
      JOIN "Source" s ON s.id = ra."sourceId"
      WHERE ra.row_number <= ${limitPerSource}
      GROUP BY s.id, s.code, s.name
    `;

    return rows.map((row) => ({
      sourceId: row.sourceId,
      sourceCode: row.sourceCode as SourceAdapterKey,
      sourceName: row.sourceName,
      count: this.normalizeCount(row.count),
    }));
  }

  async listRecentUsefulRawPayloadCounts(
    limitPerSource: number,
  ): Promise<readonly DiagnosticsSourceEntityCountRecord[]> {
    const rows = await this.prismaService.$queryRaw<
      {
        sourceId: string;
        sourceCode: string;
        sourceName: string;
        count: bigint | number;
      }[]
    >`
      WITH ranked_archives AS (
        SELECT
          r.id,
          r."sourceId",
          ROW_NUMBER() OVER (
            PARTITION BY r."sourceId"
            ORDER BY r."observedAt" DESC, r."archivedAt" DESC, r.id DESC
          ) AS row_number
        FROM "RawPayloadArchive" r
      ),
      recent_archives AS (
        SELECT id, "sourceId"
        FROM ranked_archives
        WHERE row_number <= ${limitPerSource}
      ),
      useful_archives AS (
        SELECT DISTINCT ra."sourceId", ra.id AS "rawPayloadArchiveId"
        FROM recent_archives ra
        JOIN "SourceEntityProvenance" sep
          ON sep."rawPayloadArchiveId" = ra.id
        UNION
        SELECT DISTINCT ra."sourceId", ra.id AS "rawPayloadArchiveId"
        FROM recent_archives ra
        JOIN "SourceMarketFact" smf
          ON smf."rawPayloadArchiveId" = ra.id
        UNION
        SELECT DISTINCT ra."sourceId", ra.id AS "rawPayloadArchiveId"
        FROM recent_archives ra
        JOIN "PendingSourceMapping" psm
          ON psm."rawPayloadArchiveId" = ra.id
        UNION
        SELECT DISTINCT ra."sourceId", ra.id AS "rawPayloadArchiveId"
        FROM recent_archives ra
        JOIN "MarketSnapshot" ms
          ON ms."rawPayloadArchiveId" = ra.id
      )
      SELECT
        s.id AS "sourceId",
        s.code AS "sourceCode",
        s.name AS "sourceName",
        COUNT(*) AS "count"
      FROM useful_archives ua
      JOIN "Source" s ON s.id = ua."sourceId"
      GROUP BY s.id, s.code, s.name
    `;

    return rows.map((row) => ({
      sourceId: row.sourceId,
      sourceCode: row.sourceCode as SourceAdapterKey,
      sourceName: row.sourceName,
      count: this.normalizeCount(row.count),
    }));
  }

  async listProjectionSkipCounts(): Promise<
    readonly DiagnosticsSourceEntityCountRecord[]
  > {
    const rows = await this.prismaService.$queryRaw<
      {
        sourceId: string;
        sourceCode: string;
        sourceName: string;
        count: bigint | number;
      }[]
    >`
      SELECT
        s.id AS "sourceId",
        s.code AS "sourceCode",
        s.name AS "sourceName",
        COALESCE(
          SUM(
            CASE
              WHEN shm.details ->> 'stage' = ${UPDATE_MARKET_STATE_QUEUE_NAME}
                THEN COALESCE((shm.details ->> 'unchangedProjectionSkipCount')::bigint, 0)
              ELSE 0
            END
          ),
          0
        ) AS "count"
      FROM "Source" s
      LEFT JOIN "SourceHealthMetric" shm
        ON shm."sourceId" = s.id
      GROUP BY s.id, s.code, s.name
    `;

    return rows.map((row) => ({
      sourceId: row.sourceId,
      sourceCode: row.sourceCode as SourceAdapterKey,
      sourceName: row.sourceName,
      count: this.normalizeCount(row.count),
    }));
  }

  async listLatestNormalizedAtBySource(): Promise<
    readonly DiagnosticsSourceTimestampRecord[]
  > {
    const groups = await this.prismaService.itemSourceFreshness.groupBy({
      by: ['sourceId'],
      where: {
        lastNormalizedAt: {
          not: null,
        },
      },
      _max: {
        lastNormalizedAt: true,
      },
    });

    return this.mapGroupedSourceTimestamps(
      groups
        .map((group) =>
          group._max.lastNormalizedAt
            ? {
                sourceId: group.sourceId,
                timestamp: group._max.lastNormalizedAt,
              }
            : null,
        )
        .filter(
          (group): group is { sourceId: string; timestamp: Date } =>
            group !== null,
        ),
    );
  }

  async listLatestRawPayloadObservedAtByEndpoint(): Promise<
    readonly DiagnosticsRawPayloadEndpointRecord[]
  > {
    const groups = await this.prismaService.rawPayloadArchive.groupBy({
      by: ['sourceId', 'endpointName'],
      _max: {
        observedAt: true,
      },
    });

    if (groups.length === 0) {
      return [];
    }

    const sources = await this.prismaService.source.findMany({
      where: {
        id: {
          in: [...new Set(groups.map((group) => group.sourceId))],
        },
      },
      select: {
        id: true,
        code: true,
        name: true,
      },
    });
    const sourceById = new Map(
      sources.map((source) => [source.id, source] as const),
    );

    return groups
      .map((group) => {
        const source = sourceById.get(group.sourceId);

        if (!source || !group._max.observedAt) {
          return null;
        }

        return {
          sourceId: source.id,
          sourceCode: source.code as SourceAdapterKey,
          sourceName: source.name,
          endpointName: group.endpointName,
          latestObservedAt: group._max.observedAt,
        } satisfies DiagnosticsRawPayloadEndpointRecord;
      })
      .filter(
        (record): record is DiagnosticsRawPayloadEndpointRecord =>
          record !== null,
      );
  }

  async getOverlapCoverage(): Promise<DiagnosticsOverlapCoverageRecord> {
    const rows = await this.prismaService.$queryRaw<
      {
        variantsWithTwoPlusSources: bigint | number;
        variantsWithThreePlusSources: bigint | number;
      }[]
    >`
      WITH source_counts AS (
        SELECT
          "itemVariantId",
          COUNT(DISTINCT "sourceId") AS source_count
        FROM "MarketState"
        GROUP BY "itemVariantId"
      )
      SELECT
        COUNT(*) FILTER (WHERE source_count >= 2) AS "variantsWithTwoPlusSources",
        COUNT(*) FILTER (WHERE source_count >= 3) AS "variantsWithThreePlusSources"
      FROM source_counts
    `;
    const row = rows[0];

    return {
      variantsWithTwoPlusSources: this.normalizeCount(
        row?.variantsWithTwoPlusSources,
      ),
      variantsWithThreePlusSources: this.normalizeCount(
        row?.variantsWithThreePlusSources,
      ),
    };
  }

  async listPairableVariantCountsBySourcePair(): Promise<
    readonly DiagnosticsSourcePairOverlapRecord[]
  > {
    const rows = await this.prismaService.$queryRaw<
      {
        leftSourceCode: string;
        leftSourceName: string;
        rightSourceCode: string;
        rightSourceName: string;
        canonicalOverlapCount: bigint | number;
        pairableVariantCount: bigint | number;
        blockedVariantCount: bigint | number;
        overlapQualityScore: number | string;
      }[]
    >`
      WITH canonical_overlap AS (
        SELECT
          left_state."sourceId" AS "leftSourceId",
          right_state."sourceId" AS "rightSourceId",
          COUNT(DISTINCT left_state."itemVariantId") AS "canonicalOverlapCount"
        FROM "MarketState" AS left_state
        JOIN "MarketState" AS right_state
          ON left_state."itemVariantId" = right_state."itemVariantId"
         AND left_state."sourceId" < right_state."sourceId"
        GROUP BY left_state."sourceId", right_state."sourceId"
      ),
      pairable_overlap AS (
        SELECT
          LEAST(o."buySourceId", o."sellSourceId") AS "leftSourceId",
          GREATEST(o."buySourceId", o."sellSourceId") AS "rightSourceId",
          COUNT(DISTINCT o."itemVariantId") AS "pairableVariantCount"
        FROM "Opportunity" o
        WHERE o.status = 'OPEN'
          AND (o."expiresAt" IS NULL OR o."expiresAt" > NOW())
        GROUP BY
          LEAST(o."buySourceId", o."sellSourceId"),
          GREATEST(o."buySourceId", o."sellSourceId")
      )
      SELECT
        left_source.code AS "leftSourceCode",
        left_source.name AS "leftSourceName",
        right_source.code AS "rightSourceCode",
        right_source.name AS "rightSourceName",
        COALESCE(canonical_overlap."canonicalOverlapCount", 0) AS "canonicalOverlapCount",
        COALESCE(pairable_overlap."pairableVariantCount", 0) AS "pairableVariantCount",
        GREATEST(
          0,
          COALESCE(canonical_overlap."canonicalOverlapCount", 0) -
            COALESCE(pairable_overlap."pairableVariantCount", 0)
        ) AS "blockedVariantCount",
        CASE
          WHEN COALESCE(canonical_overlap."canonicalOverlapCount", 0) > 0
            THEN ROUND(
              COALESCE(pairable_overlap."pairableVariantCount", 0)::numeric /
                canonical_overlap."canonicalOverlapCount"::numeric,
              4
            )
          ELSE 0
        END AS "overlapQualityScore"
      FROM canonical_overlap
      FULL OUTER JOIN pairable_overlap
        ON pairable_overlap."leftSourceId" = canonical_overlap."leftSourceId"
       AND pairable_overlap."rightSourceId" = canonical_overlap."rightSourceId"
      JOIN "Source" AS left_source
        ON left_source.id = COALESCE(
          canonical_overlap."leftSourceId",
          pairable_overlap."leftSourceId"
        )
      JOIN "Source" AS right_source
        ON right_source.id = COALESCE(
          canonical_overlap."rightSourceId",
          pairable_overlap."rightSourceId"
        )
      ORDER BY
        "overlapQualityScore" DESC,
        "pairableVariantCount" DESC,
        "leftSourceCode" ASC,
        "rightSourceCode" ASC
    `;

    return rows.map((row) => ({
      leftSourceCode: row.leftSourceCode as SourceAdapterKey,
      leftSourceName: row.leftSourceName,
      rightSourceCode: row.rightSourceCode as SourceAdapterKey,
      rightSourceName: row.rightSourceName,
      canonicalOverlapCount: this.normalizeCount(row.canonicalOverlapCount),
      pairableVariantCount: this.normalizeCount(row.pairableVariantCount),
      blockedVariantCount: this.normalizeCount(row.blockedVariantCount),
      overlapQualityScore: Number(row.overlapQualityScore),
    }));
  }

  async findLatestOpportunityRescanRecord(): Promise<DiagnosticsLatestOpportunityRescanRecord | null> {
    const jobRun = await this.prismaService.jobRun.findFirst({
      where: {
        queueName: 'jobs-opportunity-rescan',
        status: JobRunStatus.SUCCEEDED,
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

  async getCsFloatCoverageMetrics(input: {
    readonly hotVariantIds: readonly string[];
    readonly recentDetailFetchLimit: number;
  }): Promise<DiagnosticsCsFloatCoverageRecord> {
    const sources = await this.prismaService.source.findMany({
      where: {
        code: {
          in: ['skinport', 'csfloat'],
        },
      },
      select: {
        id: true,
        code: true,
      },
    });
    const skinportSourceId = sources.find(
      (source) => source.code === 'skinport',
    )?.id;
    const csfloatSourceId = sources.find(
      (source) => source.code === 'csfloat',
    )?.id;

    if (!skinportSourceId || !csfloatSourceId) {
      return {
        skinportTrackedVariantCount: 0,
        csfloatTrackedVariantCount: 0,
        overlapWithSkinportCount: 0,
        csfloatOverlapEligibleVariantCount: 0,
        csfloatActiveListingCount: 0,
        hotVariantCount: input.hotVariantIds.length,
        csfloatCoveredHotVariantCount: 0,
        csfloatActiveListingsOnHotVariants: 0,
        recentDetailFetchCount: 0,
        recentUsefulDetailFetchCount: 0,
      };
    }

    const [
      skinportStates,
      csfloatStates,
      csfloatActiveListingCount,
      csfloatCoveredHotVariantCount,
      csfloatActiveListingsOnHotVariants,
      recentDetailFetchJobs,
    ] = await Promise.all([
      this.prismaService.marketState.findMany({
        where: {
          sourceId: skinportSourceId,
        },
        select: {
          itemVariantId: true,
        },
      }),
      this.prismaService.marketState.findMany({
        where: {
          sourceId: csfloatSourceId,
        },
        select: {
          itemVariantId: true,
          listingCount: true,
          lowestAskGross: true,
        },
      }),
      this.prismaService.sourceListing.count({
        where: {
          sourceId: csfloatSourceId,
          listingStatus: ListingStatus.ACTIVE,
        },
      }),
      input.hotVariantIds.length > 0
        ? this.prismaService.marketState.count({
            where: {
              sourceId: csfloatSourceId,
              itemVariantId: {
                in: [...input.hotVariantIds],
              },
            },
          })
        : Promise.resolve(0),
      input.hotVariantIds.length > 0
        ? this.prismaService.sourceListing.count({
            where: {
              sourceId: csfloatSourceId,
              listingStatus: ListingStatus.ACTIVE,
              itemVariantId: {
                in: [...input.hotVariantIds],
              },
            },
          })
        : Promise.resolve(0),
      this.prismaService.sourceFetchJob.findMany({
        where: {
          sourceId: csfloatSourceId,
          queueName: 'csfloat-fetch-listing-detail',
          status: IngestionJobStatus.SUCCEEDED,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: input.recentDetailFetchLimit,
        select: {
          normalizedCount: true,
        },
      }),
    ]);

    const skinportVariantIds = new Set(
      skinportStates.map((state) => state.itemVariantId),
    );
    const overlapWithSkinportCount = csfloatStates.filter((state) =>
      skinportVariantIds.has(state.itemVariantId),
    ).length;
    const csfloatOverlapEligibleVariantCount = csfloatStates.filter(
      (state) =>
        skinportVariantIds.has(state.itemVariantId) &&
        Number(state.listingCount ?? 0) > 0 &&
        state.lowestAskGross !== null,
    ).length;
    const recentUsefulDetailFetchCount = recentDetailFetchJobs.filter(
      (job) => job.normalizedCount > 0,
    ).length;

    return {
      skinportTrackedVariantCount: skinportVariantIds.size,
      csfloatTrackedVariantCount: csfloatStates.length,
      overlapWithSkinportCount,
      csfloatOverlapEligibleVariantCount,
      csfloatActiveListingCount,
      hotVariantCount: input.hotVariantIds.length,
      csfloatCoveredHotVariantCount,
      csfloatActiveListingsOnHotVariants,
      recentDetailFetchCount: recentDetailFetchJobs.length,
      recentUsefulDetailFetchCount,
    };
  }

  async listRecentHealthMetrics(query: {
    readonly source?: SourceAdapterKey;
    readonly since?: Date;
    readonly limit: number;
    readonly rateLimitOnly?: boolean;
  }): Promise<readonly DiagnosticsHealthMetricWithSourceRecord[]> {
    const metrics = await this.prismaService.sourceHealthMetric.findMany({
      where: {
        ...(query.source ? { source: { code: query.source } } : {}),
        ...(query.since ? { recordedAt: { gte: query.since } } : {}),
        ...(query.rateLimitOnly ? { rateLimitRemaining: { not: null } } : {}),
      },
      include: {
        source: {
          select: {
            id: true,
            code: true,
            name: true,
            kind: true,
            metadata: true,
          },
        },
      },
      orderBy: [{ recordedAt: 'desc' }],
      take: query.limit,
    });

    return metrics.map((metric) => ({
      sourceId: metric.sourceId,
      sourceCode: metric.source.code as SourceAdapterKey,
      sourceName: metric.source.name,
      sourceKind: metric.source.kind,
      sourceMetadata: metric.source.metadata,
      ...this.toHealthMetricRecord(metric),
    }));
  }

  async listRecentJobRuns(query: {
    readonly source?: SourceAdapterKey;
    readonly queueName?: string;
    readonly since?: Date;
    readonly limit: number;
    readonly statuses?: readonly JobRunStatus[];
  }): Promise<readonly DiagnosticsJobRunRecord[]> {
    const jobRuns = await this.prismaService.jobRun.findMany({
      where: {
        ...(query.source ? { source: { code: query.source } } : {}),
        ...(query.queueName ? { queueName: query.queueName } : {}),
        ...(query.since ? { updatedAt: { gte: query.since } } : {}),
        ...(query.statuses && query.statuses.length > 0
          ? {
              status: {
                in: [...query.statuses],
              },
            }
          : {}),
      },
      include: {
        source: {
          select: {
            code: true,
            name: true,
          },
        },
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: query.limit,
    });

    return jobRuns.map((jobRun) => this.toJobRunRecord(jobRun));
  }

  async listRecentSourceSyncStatuses(query: {
    readonly source?: SourceAdapterKey;
    readonly since?: Date;
    readonly limit: number;
    readonly statuses?: readonly SyncStatus[];
  }): Promise<readonly DiagnosticsSourceSyncStatusRecord[]> {
    const syncStatuses = await this.prismaService.sourceSyncStatus.findMany({
      where: {
        ...(query.source ? { source: { code: query.source } } : {}),
        ...(query.since ? { updatedAt: { gte: query.since } } : {}),
        ...(query.statuses && query.statuses.length > 0
          ? {
              status: {
                in: [...query.statuses],
              },
            }
          : {}),
      },
      include: {
        source: {
          select: {
            code: true,
            name: true,
          },
        },
        lastJobRun: {
          include: {
            source: {
              select: {
                code: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: query.limit,
    });

    return syncStatuses.map((syncStatus) =>
      this.toSyncStatusRecord(syncStatus),
    );
  }

  async listRecentPendingSourceMappings(query: {
    readonly source?: SourceAdapterKey;
    readonly since?: Date;
    readonly unresolvedOnly?: boolean;
    readonly limit: number;
  }): Promise<readonly DiagnosticsPendingSourceMappingRecord[]> {
    const pendingMappings = await this.prismaService.pendingSourceMapping.findMany({
      where: {
        ...(query.source ? { source: { code: query.source } } : {}),
        ...(query.since ? { observedAt: { gte: query.since } } : {}),
        ...(query.unresolvedOnly ? { resolvedAt: null } : {}),
      },
      include: {
        source: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
      },
      orderBy: [{ observedAt: 'desc' }],
      take: query.limit,
    });

    return pendingMappings.map((mapping) => ({
      id: mapping.id,
      sourceId: mapping.sourceId,
      sourceCode: mapping.source.code as SourceAdapterKey,
      sourceName: mapping.source.name,
      endpointName: mapping.endpointName,
      kind: mapping.kind,
      sourceItemId: mapping.sourceItemId,
      ...(mapping.title ? { title: mapping.title } : {}),
      ...(mapping.normalizedTitle
        ? { normalizedTitle: mapping.normalizedTitle }
        : {}),
      observedAt: mapping.observedAt,
      normalizedAt: mapping.normalizedAt,
      ...(mapping.resolvedAt ? { resolvedAt: mapping.resolvedAt } : {}),
      ...(mapping.resolutionNote
        ? { resolutionNote: mapping.resolutionNote }
        : {}),
      ...(mapping.variantHints &&
      typeof mapping.variantHints === 'object' &&
      !Array.isArray(mapping.variantHints)
        ? { variantHints: mapping.variantHints as Record<string, unknown> }
        : {}),
      ...(mapping.metadata &&
      typeof mapping.metadata === 'object' &&
      !Array.isArray(mapping.metadata)
        ? { metadata: mapping.metadata as Record<string, unknown> }
        : {}),
    }));
  }

  private toHealthMetricRecord(metric: {
    readonly id: string;
    readonly status: DiagnosticsSourceHealthMetricRecord['status'];
    readonly availabilityRatio: Prisma.Decimal | null;
    readonly errorRate: Prisma.Decimal | null;
    readonly latencyP50Ms: number | null;
    readonly latencyP95Ms: number | null;
    readonly latencyP99Ms: number | null;
    readonly requestsPerMinute: number | null;
    readonly rateLimitRemaining: number | null;
    readonly queueDepth: number | null;
    readonly details: Prisma.JsonValue | null;
    readonly recordedAt: Date;
  }): DiagnosticsSourceHealthMetricRecord {
    return {
      id: metric.id,
      status: metric.status,
      availabilityRatio: metric.availabilityRatio,
      errorRate: metric.errorRate,
      latencyP50Ms: metric.latencyP50Ms,
      latencyP95Ms: metric.latencyP95Ms,
      latencyP99Ms: metric.latencyP99Ms,
      requestsPerMinute: metric.requestsPerMinute,
      rateLimitRemaining: metric.rateLimitRemaining,
      queueDepth: metric.queueDepth,
      details: metric.details,
      recordedAt: metric.recordedAt,
    };
  }

  private toJobRunRecord(jobRun: {
    readonly id: string;
    readonly sourceId: string | null;
    readonly queueName: string;
    readonly jobType: DiagnosticsJobRunRecord['jobType'];
    readonly jobName: string;
    readonly externalJobId: string | null;
    readonly status: DiagnosticsJobRunRecord['status'];
    readonly attempt: number;
    readonly maxAttempts: number;
    readonly priority: number | null;
    readonly payload: Prisma.JsonValue | null;
    readonly result: Prisma.JsonValue | null;
    readonly errorMessage: string | null;
    readonly queuedAt: Date;
    readonly startedAt: Date | null;
    readonly finishedAt: Date | null;
    readonly updatedAt: Date;
    readonly source?: {
      readonly code: string;
      readonly name: string;
    } | null;
  }): DiagnosticsJobRunRecord {
    return {
      id: jobRun.id,
      ...(jobRun.sourceId ? { sourceId: jobRun.sourceId } : {}),
      ...(jobRun.source?.code
        ? { sourceCode: jobRun.source.code as SourceAdapterKey }
        : {}),
      ...(jobRun.source?.name ? { sourceName: jobRun.source.name } : {}),
      queueName: jobRun.queueName,
      jobType: jobRun.jobType,
      jobName: jobRun.jobName,
      ...(jobRun.externalJobId ? { externalJobId: jobRun.externalJobId } : {}),
      status: jobRun.status,
      attempt: jobRun.attempt,
      maxAttempts: jobRun.maxAttempts,
      ...(jobRun.priority !== null ? { priority: jobRun.priority } : {}),
      payload: jobRun.payload,
      result: jobRun.result,
      ...(jobRun.errorMessage ? { errorMessage: jobRun.errorMessage } : {}),
      queuedAt: jobRun.queuedAt,
      ...(jobRun.startedAt ? { startedAt: jobRun.startedAt } : {}),
      ...(jobRun.finishedAt ? { finishedAt: jobRun.finishedAt } : {}),
      updatedAt: jobRun.updatedAt,
    };
  }

  private toSyncStatusRecord(syncStatus: {
    readonly id: string;
    readonly sourceId: string;
    readonly syncType: DiagnosticsSourceSyncStatusRecord['syncType'];
    readonly status: DiagnosticsSourceSyncStatusRecord['status'];
    readonly cursor: Prisma.JsonValue | null;
    readonly startedAt: Date | null;
    readonly completedAt: Date | null;
    readonly lastSuccessfulAt: Date | null;
    readonly lastFailureAt: Date | null;
    readonly consecutiveFailureCount: number;
    readonly details: Prisma.JsonValue | null;
    readonly updatedAt: Date;
    readonly source: {
      readonly code: string;
      readonly name: string;
    };
    readonly lastJobRun?: {
      readonly id: string;
      readonly sourceId: string | null;
      readonly queueName: string;
      readonly jobType: DiagnosticsJobRunRecord['jobType'];
      readonly jobName: string;
      readonly externalJobId: string | null;
      readonly status: DiagnosticsJobRunRecord['status'];
      readonly attempt: number;
      readonly maxAttempts: number;
      readonly priority: number | null;
      readonly payload: Prisma.JsonValue | null;
      readonly result: Prisma.JsonValue | null;
      readonly errorMessage: string | null;
      readonly queuedAt: Date;
      readonly startedAt: Date | null;
      readonly finishedAt: Date | null;
      readonly updatedAt: Date;
      readonly source?: {
        readonly code: string;
        readonly name: string;
      } | null;
    } | null;
  }): DiagnosticsSourceSyncStatusRecord {
    return {
      id: syncStatus.id,
      sourceId: syncStatus.sourceId,
      sourceCode: syncStatus.source.code as SourceAdapterKey,
      sourceName: syncStatus.source.name,
      syncType: syncStatus.syncType,
      status: syncStatus.status,
      cursor: syncStatus.cursor,
      ...(syncStatus.startedAt ? { startedAt: syncStatus.startedAt } : {}),
      ...(syncStatus.completedAt
        ? { completedAt: syncStatus.completedAt }
        : {}),
      ...(syncStatus.lastSuccessfulAt
        ? { lastSuccessfulAt: syncStatus.lastSuccessfulAt }
        : {}),
      ...(syncStatus.lastFailureAt
        ? { lastFailureAt: syncStatus.lastFailureAt }
        : {}),
      consecutiveFailureCount: syncStatus.consecutiveFailureCount,
      details: syncStatus.details,
      updatedAt: syncStatus.updatedAt,
      ...(syncStatus.lastJobRun
        ? { lastJobRun: this.toJobRunRecord(syncStatus.lastJobRun) }
        : {}),
    };
  }

  private async mapGroupedSourceCounts(
    groups: readonly {
      readonly sourceId: string;
      readonly _count: {
        readonly _all: number;
      };
    }[],
  ): Promise<readonly DiagnosticsSourceEntityCountRecord[]> {
    if (groups.length === 0) {
      return [];
    }

    const sources = await this.prismaService.source.findMany({
      where: {
        id: {
          in: groups.map((group) => group.sourceId),
        },
      },
      select: {
        id: true,
        code: true,
        name: true,
      },
    });
    const sourceById = new Map(
      sources.map((source) => [source.id, source] as const),
    );

    return groups
      .map((group) => {
        const source = sourceById.get(group.sourceId);

        if (!source) {
          return null;
        }

        return {
          sourceId: source.id,
          sourceCode: source.code as SourceAdapterKey,
          sourceName: source.name,
          count: group._count._all,
        } satisfies DiagnosticsSourceEntityCountRecord;
      })
      .filter(
        (record): record is DiagnosticsSourceEntityCountRecord =>
          record !== null,
      );
  }

  private async mapGroupedSourceTimestamps(
    groups: readonly {
      readonly sourceId: string;
      readonly timestamp: Date;
    }[],
  ): Promise<readonly DiagnosticsSourceTimestampRecord[]> {
    if (groups.length === 0) {
      return [];
    }

    const sources = await this.prismaService.source.findMany({
      where: {
        id: {
          in: groups.map((group) => group.sourceId),
        },
      },
      select: {
        id: true,
        code: true,
        name: true,
      },
    });
    const sourceById = new Map(
      sources.map((source) => [source.id, source] as const),
    );

    return groups
      .map((group) => {
        const source = sourceById.get(group.sourceId);

        if (!source) {
          return null;
        }

        return {
          sourceId: source.id,
          sourceCode: source.code as SourceAdapterKey,
          sourceName: source.name,
          timestamp: group.timestamp,
        } satisfies DiagnosticsSourceTimestampRecord;
      })
      .filter(
        (record): record is DiagnosticsSourceTimestampRecord =>
          record !== null,
      );
  }

  private normalizeCount(
    value: bigint | number | string | null | undefined,
  ): number {
    if (typeof value === 'bigint') {
      return Number(value);
    }

    if (typeof value === 'string') {
      const parsedValue = Number(value);

      return Number.isFinite(parsedValue) ? parsedValue : 0;
    }

    return typeof value === 'number' ? value : 0;
  }
}
