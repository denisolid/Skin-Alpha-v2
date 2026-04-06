import type { ItemCategory } from '@prisma/client';

import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';

export const WATCHLISTS_REPOSITORY = Symbol('WATCHLISTS_REPOSITORY');

export interface WatchlistItemRecord {
  readonly id: string;
  readonly canonicalItemId: string;
  readonly canonicalDisplayName: string;
  readonly itemVariantId: string;
  readonly variantDisplayName: string;
  readonly category: ItemCategory;
  readonly scopeKey: string;
  readonly notes: string | null;
  readonly source: {
    readonly id: string;
    readonly code: SourceAdapterKey;
    readonly name: string;
  } | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface WatchlistRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly isDefault: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly items: readonly WatchlistItemRecord[];
}

export interface CreateWatchlistInput {
  readonly userId: string;
  readonly name: string;
  readonly description?: string | null;
  readonly isDefault?: boolean;
}

export interface UpdateWatchlistInput {
  readonly userId: string;
  readonly watchlistId: string;
  readonly name?: string;
  readonly description?: string | null;
  readonly isDefault?: boolean;
}

export interface AddWatchlistItemInput {
  readonly userId: string;
  readonly watchlistId: string;
  readonly itemVariantId: string;
  readonly sourceCode?: SourceAdapterKey;
  readonly scopeKey: string;
  readonly notes?: string | null;
}

export interface WatchlistsRepository {
  findWatchlistsByUser(userId: string): Promise<readonly WatchlistRecord[]>;
  findWatchlistById(
    userId: string,
    watchlistId: string,
  ): Promise<WatchlistRecord | null>;
  createWatchlist(input: CreateWatchlistInput): Promise<WatchlistRecord>;
  updateWatchlist(input: UpdateWatchlistInput): Promise<WatchlistRecord | null>;
  deleteWatchlist(userId: string, watchlistId: string): Promise<boolean>;
  addWatchlistItem(
    input: AddWatchlistItemInput,
  ): Promise<WatchlistRecord | null>;
  removeWatchlistItem(
    userId: string,
    watchlistId: string,
    watchlistItemId: string,
  ): Promise<WatchlistRecord | null>;
}
