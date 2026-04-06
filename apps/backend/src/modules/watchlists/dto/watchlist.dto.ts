import type { ItemCategory } from '@prisma/client';

import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';

export interface WatchlistItemDto {
  readonly id: string;
  readonly canonicalItemId: string;
  readonly canonicalDisplayName: string;
  readonly itemVariantId: string;
  readonly variantDisplayName: string;
  readonly category: ItemCategory;
  readonly scopeKey: string;
  readonly notes?: string;
  readonly source?: {
    readonly id: string;
    readonly code: SourceAdapterKey;
    readonly name: string;
  };
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface WatchlistDto {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly isDefault: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly itemCount: number;
  readonly items: readonly WatchlistItemDto[];
}

export interface WatchlistsListDto {
  readonly watchlists: readonly WatchlistDto[];
}
