import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import type { AuthUserRecord } from '../../auth/domain/auth.repository';
import type { WatchlistsUseCase } from '../application/watchlists.use-case';
import {
  WATCHLISTS_REPOSITORY,
  type WatchlistRecord,
  type WatchlistsRepository,
} from '../domain/watchlists.repository';
import type { AddWatchlistItemDto } from '../dto/add-watchlist-item.dto';
import type { CreateWatchlistDto } from '../dto/create-watchlist.dto';
import type { UpdateWatchlistDto } from '../dto/update-watchlist.dto';
import type { WatchlistDto, WatchlistsListDto } from '../dto/watchlist.dto';

@Injectable()
export class WatchlistsService implements WatchlistsUseCase {
  constructor(
    @Inject(WATCHLISTS_REPOSITORY)
    private readonly watchlistsRepository: WatchlistsRepository,
  ) {}

  async getWatchlists(
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<WatchlistsListDto> {
    const watchlists = await this.watchlistsRepository.findWatchlistsByUser(
      user.id,
    );

    return {
      watchlists: watchlists.map((watchlist) => this.toWatchlistDto(watchlist)),
    };
  }

  async getWatchlist(
    watchlistId: string,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<WatchlistDto> {
    const watchlist = await this.watchlistsRepository.findWatchlistById(
      user.id,
      watchlistId,
    );

    if (!watchlist) {
      throw new NotFoundException(`Watchlist '${watchlistId}' was not found.`);
    }

    return this.toWatchlistDto(watchlist);
  }

  async createWatchlist(
    input: CreateWatchlistDto,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<WatchlistDto> {
    const watchlist = await this.watchlistsRepository.createWatchlist({
      userId: user.id,
      name: input.name.trim(),
      ...(input.description !== undefined
        ? { description: this.normalizeNullableText(input.description) }
        : {}),
      ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
    });

    return this.toWatchlistDto(watchlist);
  }

  async updateWatchlist(
    watchlistId: string,
    input: UpdateWatchlistDto,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<WatchlistDto> {
    const watchlist = await this.watchlistsRepository.updateWatchlist({
      userId: user.id,
      watchlistId,
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined
        ? { description: this.normalizeNullableText(input.description) }
        : {}),
      ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
    });

    if (!watchlist) {
      throw new NotFoundException(`Watchlist '${watchlistId}' was not found.`);
    }

    return this.toWatchlistDto(watchlist);
  }

  async deleteWatchlist(
    watchlistId: string,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<void> {
    const deleted = await this.watchlistsRepository.deleteWatchlist(
      user.id,
      watchlistId,
    );

    if (!deleted) {
      throw new NotFoundException(`Watchlist '${watchlistId}' was not found.`);
    }
  }

  async addWatchlistItem(
    watchlistId: string,
    input: AddWatchlistItemDto,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<WatchlistDto> {
    const scopeKey = input.scopeKey?.trim() || input.sourceCode || 'all';
    const watchlist = await this.watchlistsRepository.addWatchlistItem({
      userId: user.id,
      watchlistId,
      itemVariantId: input.itemVariantId,
      scopeKey,
      ...(input.sourceCode ? { sourceCode: input.sourceCode } : {}),
      ...(input.notes !== undefined
        ? { notes: this.normalizeNullableText(input.notes) }
        : {}),
    });

    if (!watchlist) {
      throw new NotFoundException(
        `Watchlist '${watchlistId}' or item '${input.itemVariantId}' was not found.`,
      );
    }

    return this.toWatchlistDto(watchlist);
  }

  async removeWatchlistItem(
    watchlistId: string,
    watchlistItemId: string,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<WatchlistDto> {
    const watchlist = await this.watchlistsRepository.removeWatchlistItem(
      user.id,
      watchlistId,
      watchlistItemId,
    );

    if (!watchlist) {
      throw new NotFoundException(
        `Watchlist item '${watchlistItemId}' was not found.`,
      );
    }

    return this.toWatchlistDto(watchlist);
  }

  private toWatchlistDto(watchlist: WatchlistRecord): WatchlistDto {
    return {
      id: watchlist.id,
      name: watchlist.name,
      ...(watchlist.description ? { description: watchlist.description } : {}),
      isDefault: watchlist.isDefault,
      createdAt: watchlist.createdAt,
      updatedAt: watchlist.updatedAt,
      itemCount: watchlist.items.length,
      items: watchlist.items.map((item) => ({
        id: item.id,
        canonicalItemId: item.canonicalItemId,
        canonicalDisplayName: item.canonicalDisplayName,
        itemVariantId: item.itemVariantId,
        variantDisplayName: item.variantDisplayName,
        category: item.category,
        scopeKey: item.scopeKey,
        ...(item.notes ? { notes: item.notes } : {}),
        ...(item.source ? { source: item.source } : {}),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
    };
  }

  private normalizeNullableText(value: string): string | null {
    const normalizedValue = value.trim();

    return normalizedValue.length > 0 ? normalizedValue : null;
  }
}
