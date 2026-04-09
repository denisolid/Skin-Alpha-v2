import { UserItemActionType } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { SchemeFeedOpportunityDto, OpportunityUserStateDto } from '../dto/scheme-feed.dto';

interface UserItemActionOverlayRecord {
  readonly itemVariantId: string;
  readonly actionType: UserItemActionType;
  readonly scopeKey: string;
  readonly pinOrder: number | null;
  readonly sourceCode?: string;
}

@Injectable()
export class FeedUserOverlayService {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
  ) {}

  async resolveOverlayMap(
    userId: string,
    items: readonly Pick<
      SchemeFeedOpportunityDto,
      'opportunityKey' | 'itemVariantId' | 'sourcePairKey' | 'buy' | 'sell'
    >[],
  ): Promise<ReadonlyMap<string, OpportunityUserStateDto>> {
    if (items.length === 0) {
      return new Map();
    }

    const itemVariantIds = [...new Set(items.map((item) => item.itemVariantId))];
    const now = new Date();
    const actions = await this.prismaService.userItemAction.findMany({
      where: {
        userId,
        itemVariantId: {
          in: itemVariantIds,
        },
        OR: [
          {
            expiresAt: null,
          },
          {
            expiresAt: {
              gt: now,
            },
          },
        ],
      },
      select: {
        itemVariantId: true,
        actionType: true,
        scopeKey: true,
        pinOrder: true,
        source: {
          select: {
            code: true,
          },
        },
      },
    });
    const actionsByVariant = new Map<string, UserItemActionOverlayRecord[]>();

    for (const action of actions) {
      const existing = actionsByVariant.get(action.itemVariantId) ?? [];

      existing.push({
        itemVariantId: action.itemVariantId,
        actionType: action.actionType,
        scopeKey: action.scopeKey,
        pinOrder: action.pinOrder,
        ...(action.source?.code ? { sourceCode: action.source.code } : {}),
      });
      actionsByVariant.set(action.itemVariantId, existing);
    }

    return new Map(
      items.map((item) => [
        item.opportunityKey,
        this.resolveUserState(item, actionsByVariant.get(item.itemVariantId) ?? []),
      ]),
    );
  }

  private resolveUserState(
    item: Pick<
      SchemeFeedOpportunityDto,
      'sourcePairKey' | 'buy' | 'sell'
    >,
    actions: readonly UserItemActionOverlayRecord[],
  ): OpportunityUserStateDto {
    let isFavorite = false;
    let isBlacklisted = false;
    let isMuted = false;
    let isPinned = false;
    let pinOrder: number | undefined;

    for (const action of actions) {
      if (!this.isApplicable(action, item)) {
        continue;
      }

      switch (action.actionType) {
        case UserItemActionType.FAVORITE:
          isFavorite = true;
          break;
        case UserItemActionType.BLACKLIST:
          isBlacklisted = true;
          break;
        case UserItemActionType.MUTED:
          isMuted = true;
          break;
        case UserItemActionType.PINNED:
          isPinned = true;
          if (action.pinOrder !== null) {
            pinOrder =
              pinOrder === undefined
                ? action.pinOrder
                : Math.min(pinOrder, action.pinOrder);
          }
          break;
      }
    }

    return {
      isFavorite,
      isBlacklisted,
      isMuted,
      isPinned,
      ...(pinOrder !== undefined ? { pinOrder } : {}),
    };
  }

  private isApplicable(
    action: UserItemActionOverlayRecord,
    item: Pick<SchemeFeedOpportunityDto, 'sourcePairKey' | 'buy' | 'sell'>,
  ): boolean {
    const scopeMatches =
      action.scopeKey === 'all' || action.scopeKey === item.sourcePairKey;
    const sourceMatches =
      !action.sourceCode ||
      action.sourceCode === item.buy.source ||
      action.sourceCode === item.sell.source;

    return scopeMatches && sourceMatches;
  }
}
