import { Inject, Injectable } from '@nestjs/common';

import type { AuthUserRecord } from '../../auth/domain/auth.repository';
import type { OpportunityFeedSummaryDto } from '../../opportunities/dto/opportunity-feed.dto';
import { OpportunityFeedService } from '../../opportunities/services/opportunity-feed.service';
import { SchemesService } from '../../schemes/services/schemes.service';
import type { GetSchemeFeedQueryDto } from '../dto/get-scheme-feed.query.dto';
import type {
  SchemeFeedOpportunityDto,
  SchemeFeedPageDto,
  SchemeOpportunityAnalyticsDto,
  SchemeOpportunityDetailDto,
} from '../dto/scheme-feed.dto';
import { FeedUserOverlayService } from './feed-user-overlay.service';

const DEFAULT_PAGE = 1;

@Injectable()
export class SchemeFeedService {
  constructor(
    @Inject(SchemesService)
    private readonly schemesService: SchemesService,
    @Inject(OpportunityFeedService)
    private readonly opportunityFeedService: OpportunityFeedService,
    @Inject(FeedUserOverlayService)
    private readonly feedUserOverlayService: FeedUserOverlayService,
  ) {}

  async getSchemeFeed(
    schemeId: string,
    query: GetSchemeFeedQueryDto | undefined,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<SchemeFeedPageDto> {
    const scheme = await this.schemesService.getCompiledScheme(schemeId, user);
    const resolvedFeed = await this.opportunityFeedService.getAllFullFeedForScheme(
      scheme,
      query,
    );
    const itemsWithUserState = await this.attachUserState(user.id, resolvedFeed.items);
    const visibleItems = this.applyOverlayVisibility(itemsWithUserState, query);
    const orderedItems = this.applyPinnedFirstOrdering(visibleItems, query);
    const page = query?.page ?? DEFAULT_PAGE;
    const pageSize = query?.pageSize ?? scheme.view.defaultPageSize;
    const pageOffset = (page - 1) * pageSize;
    const pagedItems = orderedItems.slice(pageOffset, pageOffset + pageSize);

    return {
      scheme: {
        id: scheme.id,
        name: scheme.name,
        revision: scheme.revision,
        status: scheme.status,
      },
      pageInfo: {
        generatedAt: resolvedFeed.generatedAt,
        page,
        pageSize,
        total: orderedItems.length,
        totalPages: Math.max(1, Math.ceil(orderedItems.length / pageSize)),
        evaluatedVariantCount: resolvedFeed.evaluatedVariantCount,
        sortBy: resolvedFeed.sortBy,
        sortDirection: resolvedFeed.sortDirection,
      },
      filters: {
        ...resolvedFeed.filters,
        ...(query?.hideBlacklisted ? { hideBlacklisted: true } : {}),
        ...(query?.hideMuted ? { hideMuted: true } : {}),
        ...(query?.pinnedFirst ? { pinnedFirst: true } : {}),
      },
      summary: this.createSummary(orderedItems),
      items: pagedItems,
    };
  }

  async getSchemeOpportunityDetail(
    schemeId: string,
    opportunityKey: string,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<SchemeOpportunityDetailDto> {
    const scheme = await this.schemesService.getCompiledScheme(schemeId, user);
    const opportunity =
      await this.opportunityFeedService.getOpportunityDetailForScheme(
        scheme,
        opportunityKey,
      );
    const userState = await this.attachUserState(user.id, [opportunity]);

    return {
      scheme: {
        id: scheme.id,
        name: scheme.name,
        revision: scheme.revision,
        status: scheme.status,
      },
      opportunity: userState[0]!,
    };
  }

  async getSchemeOpportunityAnalytics(
    schemeId: string,
    opportunityKey: string,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<SchemeOpportunityAnalyticsDto> {
    const scheme = await this.schemesService.getCompiledScheme(schemeId, user);
    const opportunity =
      await this.opportunityFeedService.getOpportunityDetailForScheme(
        scheme,
        opportunityKey,
      );
    const [withUserState] = await this.attachUserState(user.id, [opportunity]);

    return {
      scheme: {
        id: scheme.id,
        name: scheme.name,
        revision: scheme.revision,
        status: scheme.status,
      },
      opportunity: withUserState ?? {
        ...opportunity,
        userState: {
          isFavorite: false,
          isBlacklisted: false,
          isMuted: false,
          isPinned: false,
        },
      },
    };
  }

  private async attachUserState(
    userId: string,
    items: readonly import('../../opportunities/dto/opportunity-feed.dto').OpportunityFullFeedItemDto[],
  ): Promise<SchemeFeedOpportunityDto[]> {
    const overlayMap = await this.feedUserOverlayService.resolveOverlayMap(
      userId,
      items,
    );

    return items.map((item) => ({
      ...item,
      userState: overlayMap.get(item.opportunityKey) ?? {
        isFavorite: false,
        isBlacklisted: false,
        isMuted: false,
        isPinned: false,
      },
    }));
  }

  private applyOverlayVisibility(
    items: readonly SchemeFeedOpportunityDto[],
    query: GetSchemeFeedQueryDto | undefined,
  ): SchemeFeedOpportunityDto[] {
    return items.filter((item) => {
      if (query?.hideBlacklisted && item.userState.isBlacklisted) {
        return false;
      }

      if (query?.hideMuted && item.userState.isMuted) {
        return false;
      }

      return true;
    });
  }

  private applyPinnedFirstOrdering(
    items: readonly SchemeFeedOpportunityDto[],
    query: GetSchemeFeedQueryDto | undefined,
  ): SchemeFeedOpportunityDto[] {
    if (!query?.pinnedFirst) {
      return [...items];
    }

    return [...items]
      .map((item, index) => ({ item, index }))
      .sort((left, right) => {
        if (
          Number(right.item.userState.isPinned) !== Number(left.item.userState.isPinned)
        ) {
          return Number(right.item.userState.isPinned) - Number(left.item.userState.isPinned);
        }

        const leftPinOrder = left.item.userState.pinOrder ?? Number.MAX_SAFE_INTEGER;
        const rightPinOrder =
          right.item.userState.pinOrder ?? Number.MAX_SAFE_INTEGER;

        if (leftPinOrder !== rightPinOrder) {
          return leftPinOrder - rightPinOrder;
        }

        return left.index - right.index;
      })
      .map((entry) => entry.item);
  }

  private createSummary(
    items: readonly SchemeFeedOpportunityDto[],
  ): OpportunityFeedSummaryDto {
    let candidate = 0;
    let nearEligible = 0;
    let eligible = 0;
    let riskyHighUpside = 0;

    for (const item of items) {
      switch (item.disposition) {
        case 'candidate':
          candidate += 1;
          break;
        case 'near_eligible':
          nearEligible += 1;
          break;
        case 'eligible':
          eligible += 1;
          break;
        case 'risky_high_upside':
          riskyHighUpside += 1;
          break;
        case 'rejected':
          break;
      }
    }

    return {
      candidate,
      nearEligible,
      eligible,
      riskyHighUpside,
    };
  }
}
