import type { MessageEvent } from '@nestjs/common';

import type { SchemeFeedOpportunityDto } from '../../feed-query/dto/scheme-feed.dto';

export type LiveStreamEventType =
  | 'snapshot'
  | 'opportunity_upsert'
  | 'opportunity_remove'
  | 'ranking_patch'
  | 'heartbeat'
  | 'resync_required';

export type LiveSnapshotMode = 'initial' | 'reset';

export interface LiveSchemeDescriptorDto {
  readonly id: string;
  readonly name: string;
  readonly revision: number;
}

export interface LiveSnapshotEventPayloadDto {
  readonly mode: LiveSnapshotMode;
  readonly scheme: LiveSchemeDescriptorDto;
  readonly items: readonly SchemeFeedOpportunityDto[];
  readonly rankingVersion: string;
  readonly totalVisible: number;
}

export interface LiveOpportunityUpsertEventPayloadDto {
  readonly scheme: LiveSchemeDescriptorDto;
  readonly item: SchemeFeedOpportunityDto;
  readonly opportunityVersion: string;
  readonly rankHint: number;
  readonly rankingVersion: string;
}

export type LiveOpportunityRemoveReason =
  | 'no_longer_live'
  | 'expired'
  | 'scheme_deactivated';

export interface LiveOpportunityRemoveEventPayloadDto {
  readonly scheme: LiveSchemeDescriptorDto;
  readonly opportunityKey: string;
  readonly reason: LiveOpportunityRemoveReason;
  readonly rankingVersion: string;
}

export interface LiveRankingPatchEventPayloadDto {
  readonly scheme: LiveSchemeDescriptorDto;
  readonly rankingVersion: string;
  readonly order: readonly {
    readonly opportunityKey: string;
    readonly rank: number;
  }[];
}

export interface LiveHeartbeatEventPayloadDto {
  readonly serverTime: string;
  readonly retryMs: number;
}

export type LiveResyncRequiredReason =
  | 'refresh_failed'
  | 'scheme_unavailable'
  | 'no_live_schemes';

export interface LiveResyncRequiredEventPayloadDto {
  readonly reason: LiveResyncRequiredReason;
  readonly schemeId?: string;
}

export type LiveStreamEventPayloadDto =
  | LiveSnapshotEventPayloadDto
  | LiveOpportunityUpsertEventPayloadDto
  | LiveOpportunityRemoveEventPayloadDto
  | LiveRankingPatchEventPayloadDto
  | LiveHeartbeatEventPayloadDto
  | LiveResyncRequiredEventPayloadDto;

export interface LiveStreamEnvelopeDto<TPayload> {
  readonly occurredAt: string;
  readonly payload: TPayload;
}

export type LiveSseMessageEvent = MessageEvent & {
  readonly type: LiveStreamEventType;
  readonly id: string;
  readonly retry?: number;
};
