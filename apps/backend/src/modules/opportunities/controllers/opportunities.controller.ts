import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import type { AuthUserRecord } from '../../auth/domain/auth.repository';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { SessionAuthGuard } from '../../auth/guards/session-auth.guard';
import { RequireAccessTier } from '../../subscriptions/decorators/require-access-tier.decorator';
import { GetOpportunityFeedQueryDto } from '../dto/get-opportunity-feed.query.dto';
import type {
  OpportunityDetailDto,
  OpportunityFullFeedPageDto,
  OpportunityPublicFeedPageDto,
  OpportunityRejectDiagnosticsPageDto,
} from '../dto/opportunity-feed.dto';
import type {
  GetOpportunityEngineQueryDto as GetOpportunityEngineInputDto,
  GetVariantOpportunityEngineQueryDto,
} from '../dto/get-opportunity-engine.query.dto';
import type {
  OpportunityEngineScanResultDto,
  OpportunityEngineVariantResultDto,
} from '../dto/opportunity-engine.dto';
import { GetScannerUniverseQueryDto } from '../dto/get-scanner-universe.query.dto';
import { OpportunitiesStatusDto } from '../dto/opportunities-status.dto';
import type {
  ScannerUniverseItemDto,
  ScannerUniverseListDto,
  ScannerUniverseOverrideMutationDto,
} from '../dto/scanner-universe.dto';
import { SetHotUniverseOverrideDto } from '../dto/set-hot-universe-override.dto';
import { OpportunitiesService } from '../services/opportunities.service';

@Controller('opportunities')
export class OpportunitiesController {
  constructor(
    @Inject(OpportunitiesService)
    private readonly opportunitiesService: OpportunitiesService,
  ) {}

  @Get()
  getStatus(): OpportunitiesStatusDto {
    return this.opportunitiesService.getStatus();
  }

  @Get('feed/full')
  @RequireAccessTier('full_access')
  getFullFeed(
    @Query() query: GetOpportunityFeedQueryDto,
  ): Promise<OpportunityFullFeedPageDto> {
    return this.opportunitiesService.getFullFeed(query);
  }

  @Get('feed/:opportunityKey')
  @RequireAccessTier('full_access')
  getOpportunityDetail(
    @Param('opportunityKey') opportunityKey: string,
  ): Promise<OpportunityDetailDto> {
    return this.opportunitiesService.getOpportunityDetail(opportunityKey);
  }

  @Get('feed')
  getPublicFeed(
    @Query() query: GetOpportunityFeedQueryDto,
  ): Promise<OpportunityPublicFeedPageDto> {
    return this.opportunitiesService.getPublicFeed(query);
  }

  @Get('internal/reject-diagnostics')
  @UseGuards(SessionAuthGuard)
  getRejectDiagnostics(
    @CurrentUser() user: AuthUserRecord,
    @Query() query: GetOpportunityFeedQueryDto,
  ): Promise<OpportunityRejectDiagnosticsPageDto> {
    return this.opportunitiesService.getRejectDiagnostics(query, user);
  }

  @Get('engine')
  @RequireAccessTier('full_access')
  evaluateScannerUniverse(
    @Query() query: GetOpportunityEngineInputDto,
  ): Promise<OpportunityEngineScanResultDto> {
    return this.opportunitiesService.evaluateScannerUniverse(query);
  }

  @Get('engine/variants/:itemVariantId')
  @RequireAccessTier('full_access')
  evaluateVariantOpportunities(
    @Param('itemVariantId', new ParseUUIDPipe({ version: '4' }))
    itemVariantId: string,
    @Query() query: GetVariantOpportunityEngineQueryDto,
  ): Promise<OpportunityEngineVariantResultDto> {
    return this.opportunitiesService.evaluateVariantOpportunities(
      itemVariantId,
      query,
    );
  }

  @Get('scanner-universe')
  @RequireAccessTier('full_access')
  getScannerUniverse(
    @Query() query: GetScannerUniverseQueryDto,
  ): Promise<ScannerUniverseListDto> {
    return this.opportunitiesService.getScannerUniverse(query);
  }

  @Get('scanner-universe/variants/:itemVariantId')
  @RequireAccessTier('full_access')
  getScannerUniverseItem(
    @Param('itemVariantId', new ParseUUIDPipe({ version: '4' }))
    itemVariantId: string,
  ): Promise<ScannerUniverseItemDto> {
    return this.opportunitiesService.getScannerUniverseItem(itemVariantId);
  }

  @Put('scanner-universe/variants/:itemVariantId/hot-override')
  @UseGuards(SessionAuthGuard)
  setHotOverride(
    @Param('itemVariantId', new ParseUUIDPipe({ version: '4' }))
    itemVariantId: string,
    @CurrentUser() user: AuthUserRecord,
    @Body() body: SetHotUniverseOverrideDto,
  ): Promise<ScannerUniverseOverrideMutationDto> {
    return this.opportunitiesService.setHotOverride(itemVariantId, body, user);
  }

  @Delete('scanner-universe/variants/:itemVariantId/hot-override')
  @UseGuards(SessionAuthGuard)
  clearHotOverride(
    @Param('itemVariantId', new ParseUUIDPipe({ version: '4' }))
    itemVariantId: string,
    @CurrentUser() user: AuthUserRecord,
  ): Promise<ScannerUniverseOverrideMutationDto> {
    return this.opportunitiesService.clearHotOverride(itemVariantId, user);
  }
}
