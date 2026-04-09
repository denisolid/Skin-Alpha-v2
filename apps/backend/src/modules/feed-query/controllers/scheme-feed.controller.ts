import { Controller, Get, Inject, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';

import type { AuthUserRecord } from '../../auth/domain/auth.repository';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { SessionAuthGuard } from '../../auth/guards/session-auth.guard';
import { RequireAccessTier } from '../../subscriptions/decorators/require-access-tier.decorator';
import { GetSchemeFeedQueryDto } from '../dto/get-scheme-feed.query.dto';
import type {
  SchemeFeedPageDto,
  SchemeOpportunityAnalyticsDto,
  SchemeOpportunityDetailDto,
} from '../dto/scheme-feed.dto';
import { SchemeFeedService } from '../services/scheme-feed.service';

@Controller('schemes')
@UseGuards(SessionAuthGuard)
export class SchemeFeedController {
  constructor(
    @Inject(SchemeFeedService)
    private readonly schemeFeedService: SchemeFeedService,
  ) {}

  @Get(':schemeId/feed')
  @RequireAccessTier('full_access')
  getSchemeFeed(
    @Param('schemeId', new ParseUUIDPipe({ version: '4' })) schemeId: string,
    @Query() query: GetSchemeFeedQueryDto,
    @CurrentUser() user: AuthUserRecord,
  ): Promise<SchemeFeedPageDto> {
    return this.schemeFeedService.getSchemeFeed(schemeId, query, user);
  }

  @Get(':schemeId/opportunities/:opportunityKey')
  @RequireAccessTier('full_access')
  getSchemeOpportunityDetail(
    @Param('schemeId', new ParseUUIDPipe({ version: '4' })) schemeId: string,
    @Param('opportunityKey') opportunityKey: string,
    @CurrentUser() user: AuthUserRecord,
  ): Promise<SchemeOpportunityDetailDto> {
    return this.schemeFeedService.getSchemeOpportunityDetail(
      schemeId,
      opportunityKey,
      user,
    );
  }

  @Get(':schemeId/opportunities/:opportunityKey/analytics')
  @RequireAccessTier('full_access')
  getSchemeOpportunityAnalytics(
    @Param('schemeId', new ParseUUIDPipe({ version: '4' })) schemeId: string,
    @Param('opportunityKey') opportunityKey: string,
    @CurrentUser() user: AuthUserRecord,
  ): Promise<SchemeOpportunityAnalyticsDto> {
    return this.schemeFeedService.getSchemeOpportunityAnalytics(
      schemeId,
      opportunityKey,
      user,
    );
  }
}
