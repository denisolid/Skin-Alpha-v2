import type { SchemeStatus } from '@prisma/client';

import type {
  OpportunityDetailDto,
  OpportunityFullFeedPageDto,
} from '../../opportunities/dto/opportunity-feed.dto';
import type {
  SchemeAlertSettingsConfig,
  SchemeLiveOptionsConfig,
} from '../domain/scheme.model';

export interface SchemeSummaryDto {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly status: SchemeStatus;
  readonly revision: number;
  readonly feedEnabled: boolean;
  readonly liveEnabled: boolean;
  readonly alertsEnabled: boolean;
  readonly priority: number;
  readonly updatedAt: Date;
}

export interface SchemeDetailDto extends SchemeSummaryDto {
  readonly originPresetKey?: string;
  readonly configHash: string;
  readonly scope: Record<string, unknown>;
  readonly selection: Record<string, unknown>;
  readonly thresholds: Record<string, unknown>;
  readonly validation: Record<string, unknown>;
  readonly view: Record<string, unknown>;
  readonly alertSettings: SchemeAlertSettingsConfig;
  readonly liveOptions: SchemeLiveOptionsConfig;
  readonly activatedAt?: Date;
  readonly archivedAt?: Date;
  readonly createdAt: Date;
}

export interface SchemesListDto {
  readonly items: readonly SchemeSummaryDto[];
}

export interface SchemeFeedPageDto {
  readonly scheme: {
    readonly id: string;
    readonly name: string;
    readonly revision: number;
    readonly status: SchemeStatus;
  };
  readonly pageInfo: OpportunityFullFeedPageDto['pageInfo'];
  readonly filters: OpportunityFullFeedPageDto['filters'];
  readonly summary: OpportunityFullFeedPageDto['summary'];
  readonly items: OpportunityFullFeedPageDto['items'];
}

export interface SchemeOpportunityDetailDto {
  readonly scheme: {
    readonly id: string;
    readonly name: string;
    readonly revision: number;
    readonly status: SchemeStatus;
  };
  readonly item: OpportunityDetailDto;
}
