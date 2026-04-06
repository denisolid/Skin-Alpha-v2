import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import type { AuthUserRecord } from '../../auth/domain/auth.repository';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { SessionAuthGuard } from '../../auth/guards/session-auth.guard';
import { AddWatchlistItemDto } from '../dto/add-watchlist-item.dto';
import { CreateWatchlistDto } from '../dto/create-watchlist.dto';
import { UpdateWatchlistDto } from '../dto/update-watchlist.dto';
import type { WatchlistDto, WatchlistsListDto } from '../dto/watchlist.dto';
import { WatchlistsService } from '../services/watchlists.service';

@Controller('watchlists')
@UseGuards(SessionAuthGuard)
export class WatchlistsController {
  constructor(
    @Inject(WatchlistsService)
    private readonly watchlistsService: WatchlistsService,
  ) {}

  @Get()
  getWatchlists(
    @CurrentUser() user: AuthUserRecord,
  ): Promise<WatchlistsListDto> {
    return this.watchlistsService.getWatchlists(user);
  }

  @Get(':watchlistId')
  getWatchlist(
    @Param('watchlistId', new ParseUUIDPipe({ version: '4' }))
    watchlistId: string,
    @CurrentUser() user: AuthUserRecord,
  ): Promise<WatchlistDto> {
    return this.watchlistsService.getWatchlist(watchlistId, user);
  }

  @Post()
  createWatchlist(
    @Body() body: CreateWatchlistDto,
    @CurrentUser() user: AuthUserRecord,
  ): Promise<WatchlistDto> {
    return this.watchlistsService.createWatchlist(body, user);
  }

  @Patch(':watchlistId')
  updateWatchlist(
    @Param('watchlistId', new ParseUUIDPipe({ version: '4' }))
    watchlistId: string,
    @Body() body: UpdateWatchlistDto,
    @CurrentUser() user: AuthUserRecord,
  ): Promise<WatchlistDto> {
    return this.watchlistsService.updateWatchlist(watchlistId, body, user);
  }

  @Delete(':watchlistId')
  deleteWatchlist(
    @Param('watchlistId', new ParseUUIDPipe({ version: '4' }))
    watchlistId: string,
    @CurrentUser() user: AuthUserRecord,
  ): Promise<void> {
    return this.watchlistsService.deleteWatchlist(watchlistId, user);
  }

  @Post(':watchlistId/items')
  addWatchlistItem(
    @Param('watchlistId', new ParseUUIDPipe({ version: '4' }))
    watchlistId: string,
    @Body() body: AddWatchlistItemDto,
    @CurrentUser() user: AuthUserRecord,
  ): Promise<WatchlistDto> {
    return this.watchlistsService.addWatchlistItem(watchlistId, body, user);
  }

  @Delete(':watchlistId/items/:watchlistItemId')
  removeWatchlistItem(
    @Param('watchlistId', new ParseUUIDPipe({ version: '4' }))
    watchlistId: string,
    @Param('watchlistItemId', new ParseUUIDPipe({ version: '4' }))
    watchlistItemId: string,
    @CurrentUser() user: AuthUserRecord,
  ): Promise<WatchlistDto> {
    return this.watchlistsService.removeWatchlistItem(
      watchlistId,
      watchlistItemId,
      user,
    );
  }
}
