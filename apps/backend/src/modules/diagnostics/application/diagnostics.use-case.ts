import type { AuthUserRecord } from '../../auth/domain/auth.repository';
import type {
  JobRunHistoryDto,
  MarketStateFreshnessDistributionDto,
  OpportunityRejectReasonsDto,
  SourceOperationalSummaryDto,
  SourcePairOverlapSummaryDto,
  QueueLagMetricsDto,
  RateLimitBurnMetricsDto,
  SourceHealthDashboardDto,
  SourceSyncFailuresDto,
  UnresolvedMappingDiagnosticsDto,
} from '../dto/diagnostics.dto';
import type { GetDiagnosticsRecordsQueryDto } from '../dto/get-diagnostics-records.query.dto';
import type { GetDiagnosticsRejectReasonsQueryDto } from '../dto/get-diagnostics-reject-reasons.query.dto';

export interface DiagnosticsUseCase {
  getSourceHealthDashboard(
    user: Pick<AuthUserRecord, 'role'>,
  ): Promise<SourceHealthDashboardDto>;
  getQueueLagMetrics(
    user: Pick<AuthUserRecord, 'role'>,
  ): Promise<QueueLagMetricsDto>;
  getRateLimitBurnMetrics(
    query: GetDiagnosticsRecordsQueryDto,
    user: Pick<AuthUserRecord, 'role'>,
  ): Promise<RateLimitBurnMetricsDto>;
  getSourceOperationalSummary(
    query: GetDiagnosticsRecordsQueryDto,
    user: Pick<AuthUserRecord, 'role'>,
  ): Promise<SourceOperationalSummaryDto>;
  getSourcePairOverlapSummary(
    query: GetDiagnosticsRecordsQueryDto,
    user: Pick<AuthUserRecord, 'role'>,
  ): Promise<SourcePairOverlapSummaryDto>;
  getMarketStateFreshnessDistribution(
    user: Pick<AuthUserRecord, 'role'>,
  ): Promise<MarketStateFreshnessDistributionDto>;
  getUnresolvedMappings(
    query: GetDiagnosticsRecordsQueryDto,
    user: Pick<AuthUserRecord, 'role'>,
  ): Promise<UnresolvedMappingDiagnosticsDto>;
  getOpportunityRejectReasons(
    query: GetDiagnosticsRejectReasonsQueryDto,
    user: Pick<AuthUserRecord, 'role'>,
  ): Promise<OpportunityRejectReasonsDto>;
  getJobRunHistory(
    query: GetDiagnosticsRecordsQueryDto,
    user: Pick<AuthUserRecord, 'role'>,
  ): Promise<JobRunHistoryDto>;
  getSourceSyncFailures(
    query: GetDiagnosticsRecordsQueryDto,
    user: Pick<AuthUserRecord, 'role'>,
  ): Promise<SourceSyncFailuresDto>;
}
