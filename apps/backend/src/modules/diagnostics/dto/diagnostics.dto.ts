import type {
  HealthStatus,
  JobRunStatus,
  JobType,
  SourceKind,
  SyncStatus,
  SyncType,
} from '@prisma/client';

import type { OpportunityReasonCode } from '../../opportunities/domain/opportunity-engine.model';
import type { OpportunityAntiFakeCounters } from '../../opportunities/domain/anti-fake.model';
import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';

export type DiagnosticsHealthState = HealthStatus | 'UNKNOWN';
export type UnresolvedSignalKind =
  | 'pending-mapping'
  | 'job-run'
  | 'sync-status'
  | 'health-metric';

export interface DiagnosticsFreshnessCountsDto {
  readonly totalItems: number;
  readonly freshItems: number;
  readonly staleItems: number;
  readonly expiredItems: number;
  readonly freshPercent: number;
  readonly stalePercent: number;
  readonly expiredPercent: number;
  readonly lastObservedAt?: Date;
}

export interface DiagnosticsSyncStatusItemDto {
  readonly syncType: SyncType;
  readonly status: SyncStatus;
  readonly updatedAt: Date;
  readonly lastSuccessfulAt?: Date;
  readonly lastFailureAt?: Date;
  readonly consecutiveFailureCount: number;
  readonly error?: string;
  readonly lastJobRunId?: string;
}

export interface DiagnosticsJobRunHistoryItemDto {
  readonly id: string;
  readonly queueName: string;
  readonly jobType: JobType;
  readonly jobName: string;
  readonly status: JobRunStatus;
  readonly queuedAt: Date;
  readonly startedAt?: Date;
  readonly finishedAt?: Date;
  readonly durationMs?: number;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly priority?: number;
  readonly source?: SourceAdapterKey;
  readonly sourceName?: string;
  readonly errorMessage?: string;
}

export interface SourceHealthDashboardItemDto {
  readonly source: SourceAdapterKey;
  readonly sourceName: string;
  readonly sourceKind: SourceKind;
  readonly isEnabled: boolean;
  readonly integrationModel?: string;
  readonly operationalStage?: string;
  readonly runtimeState?: 'active' | 'degraded' | 'cooldown' | 'disabled';
  readonly runtimeReason?: string;
  readonly requiresProxy?: boolean;
  readonly requiresSession?: boolean;
  readonly requiresAccount?: boolean;
  readonly healthStatus: DiagnosticsHealthState;
  readonly healthCheckedAt?: Date;
  readonly availabilityRatio?: number;
  readonly errorRate?: number;
  readonly latencyP95Ms?: number;
  readonly queueDepth?: number;
  readonly latestRateLimitRemaining?: number;
  readonly lastSuccessfulSyncAt?: Date;
  readonly lastFailureAt?: Date;
  readonly consecutiveFailures: number;
  readonly freshness: DiagnosticsFreshnessCountsDto;
  readonly syncStatuses: readonly DiagnosticsSyncStatusItemDto[];
  readonly latestJobRun?: DiagnosticsJobRunHistoryItemDto;
}

export interface SourceHealthDashboardDto {
  readonly generatedAt: Date;
  readonly summary: {
    readonly sourceCount: number;
    readonly okSources: number;
    readonly degradedSources: number;
    readonly failedSources: number;
    readonly unknownSources: number;
    readonly totalTrackedItems: number;
    readonly staleTrackedItems: number;
    readonly expiredTrackedItems: number;
  };
  readonly sources: readonly SourceHealthDashboardItemDto[];
}

export interface QueueLagMetricDto {
  readonly queueName: string;
  readonly queuedCount: number;
  readonly runningCount: number;
  readonly backlogCount: number;
  readonly oldestQueuedAgeMs?: number;
  readonly oldestRunningAgeMs?: number;
  readonly succeededLast24h: number;
  readonly failedLast24h: number;
  readonly canceledLast24h: number;
}

export interface SchedulerLockMetricDto {
  readonly key: string;
  readonly held: boolean;
  readonly ttlMs?: number;
  readonly acquiredAt?: Date;
}

export interface QueueLagMetricsDto {
  readonly generatedAt: Date;
  readonly summary: {
    readonly queuedCount: number;
    readonly runningCount: number;
    readonly backlogCount: number;
    readonly failedLast24h: number;
  };
  readonly queues: readonly QueueLagMetricDto[];
  readonly maintenanceLocks: readonly SchedulerLockMetricDto[];
}

export interface RateLimitBurnMetricDto {
  readonly source: SourceAdapterKey;
  readonly endpointName: string;
  readonly status: 'available' | 'limited' | 'cooldown' | 'unknown';
  readonly recordedAt?: Date;
  readonly windowLimit?: number;
  readonly windowRemaining?: number;
  readonly burnPercent?: number;
  readonly retryAfterSeconds?: number;
  readonly note?: string;
}

export interface RateLimitBurnMetricsDto {
  readonly generatedAt: Date;
  readonly metrics: readonly RateLimitBurnMetricDto[];
}

export interface SourceOperationalSummaryItemDto {
  readonly source: SourceAdapterKey;
  readonly sourceName: string;
  readonly sourceKind: SourceKind;
  readonly isEnabled: boolean;
  readonly classification?: string;
  readonly integrationModel?: string;
  readonly operationalStage?: string;
  readonly runtimeState?: 'active' | 'degraded' | 'cooldown' | 'disabled';
  readonly runtimeReason?: string;
  readonly requiresProxy?: boolean;
  readonly requiresSession?: boolean;
  readonly requiresAccount?: boolean;
  readonly rawPayloadArchivesCount: number;
  readonly sourceListingsCount: number;
  readonly sourceMarketFactsCount: number;
  readonly marketSnapshotsCount: number;
  readonly marketStatesCount: number;
  readonly pendingMappingsCount: number;
  readonly unresolvedMappingSignalCount: number;
  readonly latestRawPayloadObservedAt?: Date;
  readonly latestMarketStateObservedAt?: Date;
  readonly latestNormalizedAt?: Date;
  readonly rawToStateLagMs?: number;
  readonly projectionAmplificationRatio?: number;
  readonly usefulPayloadRatio?: number;
  readonly unchangedProjectionSkipCount: number;
  readonly canonicalOverlapVariantCount: number;
  readonly pairableOverlapVariantCount: number;
  readonly blockedOverlapVariantCount: number;
  readonly averageOverlapQualityScore?: number;
}

export interface CsFloatCoverageDiagnosticsDto {
  readonly skinportTrackedVariantCount: number;
  readonly csfloatTrackedVariantCount: number;
  readonly overlapWithSkinportCount: number;
  readonly csfloatOverlapEligibleVariantCount: number;
  readonly csfloatCoverageGapVsSkinport: number;
  readonly hotVariantCount: number;
  readonly csfloatCoveredHotVariantCount: number;
  readonly csfloatHotVariantCoverage: number;
  readonly csfloatActiveListingCount: number;
  readonly csfloatListingsPerHotVariant: number;
  readonly recentDetailFetchCount: number;
  readonly recentUsefulDetailFetchCount: number;
  readonly usefulDetailFetchRatio?: number;
}

export interface SourceOperationalSummaryDto {
  readonly generatedAt: Date;
  readonly variantsWithTwoPlusSources: number;
  readonly variantsWithThreePlusSources: number;
  readonly sources: readonly SourceOperationalSummaryItemDto[];
  readonly csfloatCoverage?: CsFloatCoverageDiagnosticsDto;
}

export interface SourcePairOverlapItemDto {
  readonly leftSource: SourceAdapterKey;
  readonly leftSourceName: string;
  readonly rightSource: SourceAdapterKey;
  readonly rightSourceName: string;
  readonly canonicalOverlapCount: number;
  readonly pairableVariantCount: number;
  readonly blockedVariantCount: number;
  readonly overlapQualityScore: number;
  readonly pairBuildingAllowed: boolean;
  readonly pairPolicy: 'standard' | 'penalized' | 'confirmation-only';
}

export interface PairRejectionBucketCountsDto {
  readonly sourcePolicy: number;
  readonly confidence: number;
  readonly freshness: number;
  readonly missingAsk: number;
  readonly categoryRules: number;
}

export interface SourcePairOverlapSummaryDto {
  readonly generatedAt: Date;
  readonly variantsWithTwoPlusSources: number;
  readonly variantsWithThreePlusSources: number;
  readonly pairableSourcePairs: readonly SourcePairOverlapItemDto[];
  readonly rejectedByBucket: PairRejectionBucketCountsDto;
}

export interface MarketStateFreshnessDistributionItemDto {
  readonly source: SourceAdapterKey;
  readonly sourceName: string;
  readonly sourceKind: SourceKind;
  readonly freshness: DiagnosticsFreshnessCountsDto;
}

export interface MarketStateFreshnessDistributionDto {
  readonly generatedAt: Date;
  readonly overall: DiagnosticsFreshnessCountsDto;
  readonly sources: readonly MarketStateFreshnessDistributionItemDto[];
}

export interface UnresolvedMappingItemDto {
  readonly source: SourceAdapterKey;
  readonly sourceName: string;
  readonly itemHint?: string;
  readonly occurrences: number;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
  readonly evidenceKinds: readonly UnresolvedSignalKind[];
  readonly sampleMessage: string;
}

export interface UnresolvedMappingDiagnosticsDto {
  readonly generatedAt: Date;
  readonly lookbackHours: number;
  readonly note: string;
  readonly items: readonly UnresolvedMappingItemDto[];
}

export interface OpportunityRejectReasonMetricDto {
  readonly reasonCode: OpportunityReasonCode;
  readonly count: number;
  readonly shareOfRejectedPairs: number;
  readonly sampleSourcePairs: readonly string[];
  readonly sampleItems: readonly string[];
}

export interface OpportunityRejectReasonsDto {
  readonly generatedAt: Date;
  readonly evaluatedItemCount: number;
  readonly evaluatedPairCount: number;
  readonly rejectedPairCount: number;
  readonly antiFakeCounters: OpportunityAntiFakeCounters;
  readonly reasons: readonly OpportunityRejectReasonMetricDto[];
}

export interface JobRunHistoryDto {
  readonly generatedAt: Date;
  readonly limit: number;
  readonly items: readonly DiagnosticsJobRunHistoryItemDto[];
}

export interface SourceSyncFailureItemDto {
  readonly source: SourceAdapterKey;
  readonly sourceName: string;
  readonly syncType: SyncType;
  readonly status: SyncStatus;
  readonly updatedAt: Date;
  readonly lastSuccessfulAt?: Date;
  readonly lastFailureAt?: Date;
  readonly consecutiveFailureCount: number;
  readonly error?: string;
  readonly lastJobRun?: DiagnosticsJobRunHistoryItemDto;
}

export interface SourceSyncFailuresDto {
  readonly generatedAt: Date;
  readonly items: readonly SourceSyncFailureItemDto[];
}
