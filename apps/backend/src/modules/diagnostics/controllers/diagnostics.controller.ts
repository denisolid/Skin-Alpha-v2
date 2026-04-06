import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';

import type { AuthUserRecord } from '../../auth/domain/auth.repository';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { SessionAuthGuard } from '../../auth/guards/session-auth.guard';
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
import { GetDiagnosticsRecordsQueryDto } from '../dto/get-diagnostics-records.query.dto';
import { GetDiagnosticsRejectReasonsQueryDto } from '../dto/get-diagnostics-reject-reasons.query.dto';
import { DiagnosticsService } from '../services/diagnostics.service';

@Controller('diagnostics')
@UseGuards(SessionAuthGuard)
export class DiagnosticsController {
  constructor(
    @Inject(DiagnosticsService)
    private readonly diagnosticsService: DiagnosticsService,
  ) {}

  @Get()
  getDashboard(
    @CurrentUser() user: AuthUserRecord,
  ): Promise<SourceHealthDashboardDto> {
    return this.diagnosticsService.getSourceHealthDashboard(user);
  }

  @Get('sources/health')
  getSourceHealthDashboard(
    @CurrentUser() user: AuthUserRecord,
  ): Promise<SourceHealthDashboardDto> {
    return this.diagnosticsService.getSourceHealthDashboard(user);
  }

  @Get('queues/lag')
  getQueueLagMetrics(
    @CurrentUser() user: AuthUserRecord,
  ): Promise<QueueLagMetricsDto> {
    return this.diagnosticsService.getQueueLagMetrics(user);
  }

  @Get('rate-limits')
  getRateLimitBurnMetrics(
    @Query() query: GetDiagnosticsRecordsQueryDto,
    @CurrentUser() user: AuthUserRecord,
  ): Promise<RateLimitBurnMetricsDto> {
    return this.diagnosticsService.getRateLimitBurnMetrics(query, user);
  }

  @Get('sources/summary')
  getSourceOperationalSummary(
    @Query() query: GetDiagnosticsRecordsQueryDto,
    @CurrentUser() user: AuthUserRecord,
  ): Promise<SourceOperationalSummaryDto> {
    return this.diagnosticsService.getSourceOperationalSummary(query, user);
  }

  @Get('overlap/summary')
  getSourcePairOverlapSummary(
    @Query() query: GetDiagnosticsRecordsQueryDto,
    @CurrentUser() user: AuthUserRecord,
  ): Promise<SourcePairOverlapSummaryDto> {
    return this.diagnosticsService.getSourcePairOverlapSummary(query, user);
  }

  @Get('market-state/freshness')
  getMarketStateFreshnessDistribution(
    @CurrentUser() user: AuthUserRecord,
  ): Promise<MarketStateFreshnessDistributionDto> {
    return this.diagnosticsService.getMarketStateFreshnessDistribution(user);
  }

  @Get('mapping/unresolved')
  getUnresolvedMappings(
    @Query() query: GetDiagnosticsRecordsQueryDto,
    @CurrentUser() user: AuthUserRecord,
  ): Promise<UnresolvedMappingDiagnosticsDto> {
    return this.diagnosticsService.getUnresolvedMappings(query, user);
  }

  @Get('opportunities/reject-reasons')
  getOpportunityRejectReasons(
    @Query() query: GetDiagnosticsRejectReasonsQueryDto,
    @CurrentUser() user: AuthUserRecord,
  ): Promise<OpportunityRejectReasonsDto> {
    return this.diagnosticsService.getOpportunityRejectReasons(query, user);
  }

  @Get('jobs/history')
  getJobRunHistory(
    @Query() query: GetDiagnosticsRecordsQueryDto,
    @CurrentUser() user: AuthUserRecord,
  ): Promise<JobRunHistoryDto> {
    return this.diagnosticsService.getJobRunHistory(query, user);
  }

  @Get('sync-failures')
  getSourceSyncFailures(
    @Query() query: GetDiagnosticsRecordsQueryDto,
    @CurrentUser() user: AuthUserRecord,
  ): Promise<SourceSyncFailuresDto> {
    return this.diagnosticsService.getSourceSyncFailures(query, user);
  }
}
