import { Controller, Headers, Inject, Query, Req, Sse } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import type { Request } from 'express';
import type { Observable } from 'rxjs';

import type { AuthUserRecord } from '../../auth/domain/auth.repository';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequireAccessTier } from '../../subscriptions/decorators/require-access-tier.decorator';
import { GetLiveStreamQueryDto } from '../dto/get-live-stream.query.dto';
import { LiveStreamService } from '../services/live-stream.service';

@Controller('live')
export class LiveStreamController {
  constructor(
    @Inject(LiveStreamService)
    private readonly liveStreamService: LiveStreamService,
  ) {}

  @Sse('stream')
  @RequireAccessTier('full_access')
  stream(
    @Query() query: GetLiveStreamQueryDto,
    @CurrentUser() user: AuthUserRecord,
    @Req() request: Request,
    @Headers('last-event-id') lastEventId?: string,
  ): Observable<MessageEvent> {
    return this.liveStreamService.createStream({
      user,
      query,
      request,
      ...(lastEventId ? { lastEventId } : {}),
    });
  }
}
