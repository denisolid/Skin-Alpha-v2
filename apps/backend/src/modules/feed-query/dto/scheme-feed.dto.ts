import type {
  OpportunityFeedFiltersDto,
  OpportunityFeedPageInfoDto,
  OpportunityFeedSummaryDto,
  OpportunityFullFeedItemDto,
} from '../../opportunities/dto/opportunity-feed.dto';
import type { SchemeStatus } from '@prisma/client';

export interface OpportunityUserStateDto {
  readonly isFavorite: boolean;
  readonly isBlacklisted: boolean;
  readonly isMuted: boolean;
  readonly isPinned: boolean;
  readonly pinOrder?: number;
}

export type SchemeFeedOpportunityDto = OpportunityFullFeedItemDto & {
  readonly userState: OpportunityUserStateDto;
};

export interface SchemeFeedFiltersWithOverlayDto extends OpportunityFeedFiltersDto {
  readonly hideBlacklisted?: boolean;
  readonly hideMuted?: boolean;
  readonly pinnedFirst?: boolean;
}

export interface SchemeFeedPageDto {
  readonly scheme: {
    readonly id: string;
    readonly name: string;
    readonly revision: number;
    readonly status: SchemeStatus;
  };
  readonly pageInfo: OpportunityFeedPageInfoDto;
  readonly filters: SchemeFeedFiltersWithOverlayDto;
  readonly summary: OpportunityFeedSummaryDto;
  readonly items: readonly SchemeFeedOpportunityDto[];
}

export interface SchemeOpportunityDetailDto {
  readonly scheme: {
    readonly id: string;
    readonly name: string;
    readonly revision: number;
    readonly status: SchemeStatus;
  };
  readonly opportunity: SchemeFeedOpportunityDto;
}

export interface SchemeOpportunityAnalyticsDto {
  readonly scheme: {
    readonly id: string;
    readonly name: string;
    readonly revision: number;
    readonly status: SchemeStatus;
  };
  readonly opportunity: SchemeFeedOpportunityDto;
}
