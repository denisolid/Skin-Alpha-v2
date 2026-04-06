import { Prisma } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';
import type {
  AddWatchlistItemInput,
  CreateWatchlistInput,
  UpdateWatchlistInput,
  WatchlistRecord,
  WatchlistsRepository,
} from '../domain/watchlists.repository';

const watchlistInclude = Prisma.validator<Prisma.WatchlistInclude>()({
  items: {
    include: {
      source: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
      canonicalItem: {
        select: {
          id: true,
          displayName: true,
          category: true,
        },
      },
      itemVariant: {
        select: {
          id: true,
          displayName: true,
        },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  },
});

type WatchlistWithItems = Prisma.WatchlistGetPayload<{
  include: typeof watchlistInclude;
}>;

@Injectable()
export class WatchlistsRepositoryAdapter implements WatchlistsRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
  ) {}

  async findWatchlistsByUser(
    userId: string,
  ): Promise<readonly WatchlistRecord[]> {
    const watchlists = await this.prismaService.watchlist.findMany({
      where: {
        userId,
      },
      include: watchlistInclude,
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }, { name: 'asc' }],
    });

    return watchlists.map((watchlist) => this.mapWatchlist(watchlist));
  }

  async findWatchlistById(
    userId: string,
    watchlistId: string,
  ): Promise<WatchlistRecord | null> {
    const watchlist = await this.prismaService.watchlist.findFirst({
      where: {
        id: watchlistId,
        userId,
      },
      include: watchlistInclude,
    });

    return watchlist ? this.mapWatchlist(watchlist) : null;
  }

  async createWatchlist(input: CreateWatchlistInput): Promise<WatchlistRecord> {
    return this.prismaService.$transaction(async (transaction) => {
      const existingCount = await transaction.watchlist.count({
        where: {
          userId: input.userId,
        },
      });
      const isDefault = input.isDefault ?? existingCount === 0;

      if (isDefault) {
        await transaction.watchlist.updateMany({
          where: {
            userId: input.userId,
          },
          data: {
            isDefault: false,
          },
        });
      }

      const watchlist = await transaction.watchlist.create({
        data: {
          userId: input.userId,
          name: input.name,
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          isDefault,
        },
        include: watchlistInclude,
      });

      return this.mapWatchlist(watchlist);
    });
  }

  async updateWatchlist(
    input: UpdateWatchlistInput,
  ): Promise<WatchlistRecord | null> {
    const existingWatchlist = await this.prismaService.watchlist.findFirst({
      where: {
        id: input.watchlistId,
        userId: input.userId,
      },
      select: {
        id: true,
        isDefault: true,
      },
    });

    if (!existingWatchlist) {
      return null;
    }

    return this.prismaService.$transaction(async (transaction) => {
      if (input.isDefault === true) {
        await transaction.watchlist.updateMany({
          where: {
            userId: input.userId,
          },
          data: {
            isDefault: false,
          },
        });
      }

      const watchlist = await transaction.watchlist.update({
        where: {
          id: input.watchlistId,
        },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.isDefault !== undefined
            ? { isDefault: input.isDefault }
            : {}),
        },
        include: watchlistInclude,
      });

      if (existingWatchlist.isDefault && input.isDefault === false) {
        const replacementDefault = await transaction.watchlist.findFirst({
          where: {
            userId: input.userId,
            id: {
              not: input.watchlistId,
            },
          },
          orderBy: [{ updatedAt: 'desc' }, { createdAt: 'asc' }],
          select: {
            id: true,
          },
        });

        if (replacementDefault) {
          await transaction.watchlist.update({
            where: {
              id: replacementDefault.id,
            },
            data: {
              isDefault: true,
            },
          });
        }
      }

      return this.mapWatchlist(watchlist);
    });
  }

  async deleteWatchlist(userId: string, watchlistId: string): Promise<boolean> {
    const existingWatchlist = await this.prismaService.watchlist.findFirst({
      where: {
        id: watchlistId,
        userId,
      },
      select: {
        id: true,
        isDefault: true,
      },
    });

    if (!existingWatchlist) {
      return false;
    }

    await this.prismaService.$transaction(async (transaction) => {
      await transaction.watchlist.delete({
        where: {
          id: watchlistId,
        },
      });

      if (!existingWatchlist.isDefault) {
        return;
      }

      const replacementDefault = await transaction.watchlist.findFirst({
        where: {
          userId,
        },
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'asc' }],
        select: {
          id: true,
        },
      });

      if (!replacementDefault) {
        return;
      }

      await transaction.watchlist.update({
        where: {
          id: replacementDefault.id,
        },
        data: {
          isDefault: true,
        },
      });
    });

    return true;
  }

  async addWatchlistItem(
    input: AddWatchlistItemInput,
  ): Promise<WatchlistRecord | null> {
    return this.prismaService.$transaction(async (transaction) => {
      const watchlist = await transaction.watchlist.findFirst({
        where: {
          id: input.watchlistId,
          userId: input.userId,
        },
        select: {
          id: true,
        },
      });

      if (!watchlist) {
        return null;
      }

      const itemVariant = await transaction.itemVariant.findUnique({
        where: {
          id: input.itemVariantId,
        },
        select: {
          id: true,
          canonicalItemId: true,
        },
      });

      if (!itemVariant) {
        return null;
      }

      const source = input.sourceCode
        ? await transaction.source.findUnique({
            where: {
              code: input.sourceCode,
            },
            select: {
              id: true,
            },
          })
        : null;

      if (input.sourceCode && !source) {
        return null;
      }

      await transaction.watchlistItem.upsert({
        where: {
          watchlistId_itemVariantId_scopeKey: {
            watchlistId: input.watchlistId,
            itemVariantId: input.itemVariantId,
            scopeKey: input.scopeKey,
          },
        },
        update: {
          ...(source ? { sourceId: source.id } : { sourceId: null }),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
        create: {
          watchlistId: input.watchlistId,
          canonicalItemId: itemVariant.canonicalItemId,
          itemVariantId: input.itemVariantId,
          scopeKey: input.scopeKey,
          ...(source ? { sourceId: source.id } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
      });

      const fullWatchlist = await transaction.watchlist.findUnique({
        where: {
          id: input.watchlistId,
        },
        include: watchlistInclude,
      });

      return fullWatchlist ? this.mapWatchlist(fullWatchlist) : null;
    });
  }

  async removeWatchlistItem(
    userId: string,
    watchlistId: string,
    watchlistItemId: string,
  ): Promise<WatchlistRecord | null> {
    return this.prismaService.$transaction(async (transaction) => {
      const watchlist = await transaction.watchlist.findFirst({
        where: {
          id: watchlistId,
          userId,
        },
        select: {
          id: true,
        },
      });

      if (!watchlist) {
        return null;
      }

      const watchlistItem = await transaction.watchlistItem.findFirst({
        where: {
          id: watchlistItemId,
          watchlistId,
        },
        select: {
          id: true,
        },
      });

      if (!watchlistItem) {
        return null;
      }

      await transaction.watchlistItem.delete({
        where: {
          id: watchlistItemId,
        },
      });

      const fullWatchlist = await transaction.watchlist.findUnique({
        where: {
          id: watchlistId,
        },
        include: watchlistInclude,
      });

      return fullWatchlist ? this.mapWatchlist(fullWatchlist) : null;
    });
  }

  private mapWatchlist(watchlist: WatchlistWithItems): WatchlistRecord {
    return {
      id: watchlist.id,
      name: watchlist.name,
      description: watchlist.description,
      isDefault: watchlist.isDefault,
      createdAt: watchlist.createdAt,
      updatedAt: watchlist.updatedAt,
      items: watchlist.items.map((item) => ({
        id: item.id,
        canonicalItemId: item.canonicalItem.id,
        canonicalDisplayName: item.canonicalItem.displayName,
        itemVariantId: item.itemVariant.id,
        variantDisplayName: item.itemVariant.displayName,
        category: item.canonicalItem.category,
        scopeKey: item.scopeKey,
        notes: item.notes,
        source: item.source
          ? {
              id: item.source.id,
              code: item.source.code as SourceAdapterKey,
              name: item.source.name,
            }
          : null,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
    };
  }
}
