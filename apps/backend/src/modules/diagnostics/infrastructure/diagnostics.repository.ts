import { JobRunStatus, type Prisma, type SyncStatus } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  DiagnosticsOverlapCoverageRecord,
  DiagnosticsHealthMetricWithSourceRecord,
  DiagnosticsJobRunRecord,
  DiagnosticsQueueStatusRecord,
  DiagnosticsRepository,
  DiagnosticsSourceEntityCountRecord,
  DiagnosticsSourceHealthMetricRecord,
  DiagnosticsSourceOverviewRecord,
  DiagnosticsSourcePairOverlapRecord,
  DiagnosticsSourceSyncStatusRecord,
} from '../domain/diagnostics.repository';
import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';

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
        pairableVariantCount: bigint | number;
      }[]
    >`
      WITH variant_sources AS (
        SELECT
          ms."itemVariantId",
          s.id AS "sourceId",
          s.code,
          s.name
        FROM "MarketState" ms
        JOIN "Source" s ON s.id = ms."sourceId"
      )
      SELECT
        left_source.code AS "leftSourceCode",
        left_source.name AS "leftSourceName",
        right_source.code AS "rightSourceCode",
        right_source.name AS "rightSourceName",
        COUNT(DISTINCT left_source."itemVariantId") AS "pairableVariantCount"
      FROM variant_sources AS left_source
      JOIN variant_sources AS right_source
        ON left_source."itemVariantId" = right_source."itemVariantId"
       AND left_source."sourceId" < right_source."sourceId"
      GROUP BY
        left_source.code,
        left_source.name,
        right_source.code,
        right_source.name
      ORDER BY
        "pairableVariantCount" DESC,
        "leftSourceCode" ASC,
        "rightSourceCode" ASC
    `;

    return rows.map((row) => ({
      leftSourceCode: row.leftSourceCode as SourceAdapterKey,
      leftSourceName: row.leftSourceName,
      rightSourceCode: row.rightSourceCode as SourceAdapterKey,
      rightSourceName: row.rightSourceName,
      pairableVariantCount: this.normalizeCount(row.pairableVariantCount),
    }));
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

  private normalizeCount(value: bigint | number | null | undefined): number {
    if (typeof value === 'bigint') {
      return Number(value);
    }

    return typeof value === 'number' ? value : 0;
  }
}
