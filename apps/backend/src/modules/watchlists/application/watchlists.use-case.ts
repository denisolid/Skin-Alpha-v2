import type { AuthUserRecord } from '../../auth/domain/auth.repository';
import type { AddWatchlistItemDto } from '../dto/add-watchlist-item.dto';
import type { CreateWatchlistDto } from '../dto/create-watchlist.dto';
import type { UpdateWatchlistDto } from '../dto/update-watchlist.dto';
import type { WatchlistDto, WatchlistsListDto } from '../dto/watchlist.dto';

export interface WatchlistsUseCase {
  getWatchlists(user: Pick<AuthUserRecord, 'id'>): Promise<WatchlistsListDto>;
  getWatchlist(
    watchlistId: string,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<WatchlistDto>;
  createWatchlist(
    input: CreateWatchlistDto,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<WatchlistDto>;
  updateWatchlist(
    watchlistId: string,
    input: UpdateWatchlistDto,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<WatchlistDto>;
  deleteWatchlist(
    watchlistId: string,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<void>;
  addWatchlistItem(
    watchlistId: string,
    input: AddWatchlistItemDto,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<WatchlistDto>;
  removeWatchlistItem(
    watchlistId: string,
    watchlistItemId: string,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<WatchlistDto>;
}
