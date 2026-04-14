import type {
  HealthStatus,
  JobRunStatus,
  JobType,
  Prisma,
  SourceKind,
  SyncStatus,
  SyncType,
} from '@prisma/client';

import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';

export const DIAGNOSTICS_REPOSITORY = Symbol('DIAGNOSTICS_REPOSITORY');

export interface DiagnosticsSourceHealthMetricRecord {
  readonly id: string;
  readonly status: HealthStatus;
  readonly availabilityRatio?: Prisma.Decimal | null;
  readonly errorRate?: Prisma.Decimal | null;
  readonly latencyP50Ms?: number | null;
  readonly latencyP95Ms?: number | null;
  readonly latencyP99Ms?: number | null;
  readonly requestsPerMinute?: number | null;
  readonly rateLimitRemaining?: number | null;
  readonly queueDepth?: number | null;
  readonly details: Prisma.JsonValue | null;
  readonly recordedAt: Date;
}

export interface DiagnosticsJobRunRecord {
  readonly id: string;
  readonly sourceId?: string | null;
  readonly sourceCode?: SourceAdapterKey;
  readonly sourceName?: string;
  readonly queueName: string;
  readonly jobType: JobType;
  readonly jobName: string;
  readonly externalJobId?: string | null;
  readonly status: JobRunStatus;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly priority?: number | null;
  readonly payload: Prisma.JsonValue | null;
  readonly result: Prisma.JsonValue | null;
  readonly errorMessage?: string | null;
  readonly queuedAt: Date;
  readonly startedAt?: Date | null;
  readonly finishedAt?: Date | null;
  readonly updatedAt: Date;
}

export interface DiagnosticsSourceSyncStatusRecord {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceCode: SourceAdapterKey;
  readonly sourceName: string;
  readonly syncType: SyncType;
  readonly status: SyncStatus;
  readonly cursor: Prisma.JsonValue | null;
  readonly startedAt?: Date | null;
  readonly completedAt?: Date | null;
  readonly lastSuccessfulAt?: Date | null;
  readonly lastFailureAt?: Date | null;
  readonly consecutiveFailureCount: number;
  readonly details: Prisma.JsonValue | null;
  readonly updatedAt: Date;
  readonly lastJobRun?: DiagnosticsJobRunRecord | null;
}

export interface DiagnosticsSourceOverviewRecord {
  readonly id: string;
  readonly code: SourceAdapterKey;
  readonly name: string;
  readonly kind: SourceKind;
  readonly isEnabled: boolean;
  readonly metadata: Prisma.JsonValue | null;
  readonly latestHealthMetric?: DiagnosticsSourceHealthMetricRecord;
  readonly syncStatuses: readonly DiagnosticsSourceSyncStatusRecord[];
  readonly latestJobRun?: DiagnosticsJobRunRecord;
  readonly latestRawPayloadObservedAt?: Date;
  readonly latestMarketStateObservedAt?: Date;
}

export interface DiagnosticsHealthMetricWithSourceRecord extends DiagnosticsSourceHealthMetricRecord {
  readonly sourceId: string;
  readonly sourceCode: SourceAdapterKey;
  readonly sourceName: string;
  readonly sourceKind: SourceKind;
  readonly sourceMetadata: Prisma.JsonValue | null;
}

export interface DiagnosticsQueueStatusRecord {
  readonly queueName: string;
  readonly status: JobRunStatus;
  readonly count: number;
  readonly minQueuedAt?: Date | null;
  readonly minStartedAt?: Date | null;
}

export interface DiagnosticsSourceEntityCountRecord {
  readonly sourceId: string;
  readonly sourceCode: SourceAdapterKey;
  readonly sourceName: string;
  readonly count: number;
}

export interface DiagnosticsSourceTimestampRecord {
  readonly sourceId: string;
  readonly sourceCode: SourceAdapterKey;
  readonly sourceName: string;
  readonly timestamp: Date;
}

export interface DiagnosticsRawPayloadEndpointRecord {
  readonly sourceId: string;
  readonly sourceCode: SourceAdapterKey;
  readonly sourceName: string;
  readonly endpointName: string;
  readonly latestObservedAt: Date;
}

export interface DiagnosticsOverlapCoverageRecord {
  readonly variantsWithTwoPlusSources: number;
  readonly variantsWithThreePlusSources: number;
}

export interface DiagnosticsSourcePairOverlapRecord {
  readonly leftSourceCode: SourceAdapterKey;
  readonly leftSourceName: string;
  readonly rightSourceCode: SourceAdapterKey;
  readonly rightSourceName: string;
  readonly canonicalOverlapCount: number;
  readonly pairableVariantCount: number;
  readonly blockedVariantCount: number;
  readonly overlapQualityScore: number;
}

export interface DiagnosticsLatestOpportunityRescanRecord {
  readonly completedAt: Date;
  readonly result: Prisma.JsonValue | null;
}

export interface DiagnosticsCsFloatCoverageRecord {
  readonly skinportTrackedVariantCount: number;
  readonly csfloatTrackedVariantCount: number;
  readonly overlapWithSkinportCount: number;
  readonly csfloatOverlapEligibleVariantCount: number;
  readonly csfloatActiveListingCount: number;
  readonly hotVariantCount: number;
  readonly csfloatCoveredHotVariantCount: number;
  readonly csfloatActiveListingsOnHotVariants: number;
  readonly recentDetailFetchCount: number;
  readonly recentUsefulDetailFetchCount: number;
}

export interface DiagnosticsPendingSourceMappingRecord {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceCode: SourceAdapterKey;
  readonly sourceName: string;
  readonly endpointName: string;
  readonly kind: 'LISTING' | 'MARKET_FACT';
  readonly sourceItemId: string;
  readonly title?: string | null;
  readonly normalizedTitle?: string | null;
  readonly observedAt: Date;
  readonly normalizedAt: Date;
  readonly resolvedAt?: Date | null;
  readonly resolutionNote?: string | null;
  readonly variantHints?: Record<string, unknown> | null;
  readonly metadata?: Record<string, unknown> | null;
}

export interface DiagnosticsRepository {
  listSourceOverviewRecords(): Promise<
    readonly DiagnosticsSourceOverviewRecord[]
  >;
  countMarketStatesForSource(
    sourceId: string,
    filters?: {
      readonly observedAtGte?: Date;
      readonly observedAtLt?: Date;
    },
  ): Promise<number>;
  listCurrentQueueLagRecords(): Promise<
    readonly DiagnosticsQueueStatusRecord[]
  >;
  listQueueOutcomeRecords(
    since: Date,
  ): Promise<readonly DiagnosticsQueueStatusRecord[]>;
  listSourceListingCounts(): Promise<
    readonly DiagnosticsSourceEntityCountRecord[]
  >;
  listRawPayloadArchiveCounts(): Promise<
    readonly DiagnosticsSourceEntityCountRecord[]
  >;
  listSourceMarketFactCounts(): Promise<
    readonly DiagnosticsSourceEntityCountRecord[]
  >;
  listMarketSnapshotCounts(): Promise<
    readonly DiagnosticsSourceEntityCountRecord[]
  >;
  listMarketStateCounts(): Promise<
    readonly DiagnosticsSourceEntityCountRecord[]
  >;
  listPendingSourceMappingCounts(query?: {
    readonly source?: SourceAdapterKey;
    readonly unresolvedOnly?: boolean;
  }): Promise<readonly DiagnosticsSourceEntityCountRecord[]>;
  listUsefulRawPayloadCounts(): Promise<
    readonly DiagnosticsSourceEntityCountRecord[]
  >;
  listRecentRawPayloadArchiveCounts(limitPerSource: number): Promise<
    readonly DiagnosticsSourceEntityCountRecord[]
  >;
  listRecentUsefulRawPayloadCounts(limitPerSource: number): Promise<
    readonly DiagnosticsSourceEntityCountRecord[]
  >;
  listProjectionSkipCounts(): Promise<readonly DiagnosticsSourceEntityCountRecord[]>;
  listLatestNormalizedAtBySource(): Promise<
    readonly DiagnosticsSourceTimestampRecord[]
  >;
  listLatestRawPayloadObservedAtByEndpoint(): Promise<
    readonly DiagnosticsRawPayloadEndpointRecord[]
  >;
  getOverlapCoverage(): Promise<DiagnosticsOverlapCoverageRecord>;
  listPairableVariantCountsBySourcePair(): Promise<
    readonly DiagnosticsSourcePairOverlapRecord[]
  >;
  findLatestOpportunityRescanRecord(): Promise<DiagnosticsLatestOpportunityRescanRecord | null>;
  getCsFloatCoverageMetrics(input: {
    readonly hotVariantIds: readonly string[];
    readonly recentDetailFetchLimit: number;
  }): Promise<DiagnosticsCsFloatCoverageRecord>;
  listRecentHealthMetrics(query: {
    readonly source?: SourceAdapterKey;
    readonly since?: Date;
    readonly limit: number;
    readonly rateLimitOnly?: boolean;
  }): Promise<readonly DiagnosticsHealthMetricWithSourceRecord[]>;
  listRecentJobRuns(query: {
    readonly source?: SourceAdapterKey;
    readonly queueName?: string;
    readonly since?: Date;
    readonly limit: number;
    readonly statuses?: readonly JobRunStatus[];
  }): Promise<readonly DiagnosticsJobRunRecord[]>;
  listRecentSourceSyncStatuses(query: {
    readonly source?: SourceAdapterKey;
    readonly since?: Date;
    readonly limit: number;
    readonly statuses?: readonly SyncStatus[];
  }): Promise<readonly DiagnosticsSourceSyncStatusRecord[]>;
  listRecentPendingSourceMappings(query: {
    readonly source?: SourceAdapterKey;
    readonly since?: Date;
    readonly unresolvedOnly?: boolean;
    readonly limit: number;
  }): Promise<readonly DiagnosticsPendingSourceMappingRecord[]>;
}
