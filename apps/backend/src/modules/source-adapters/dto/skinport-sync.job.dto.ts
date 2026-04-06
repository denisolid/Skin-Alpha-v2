import type {
  SourceSyncMode,
  SourceSyncTrigger,
} from '../domain/source-adapter.types';
import type { SkinportSaleFeedEventDto } from './skinport-sale-feed-event.dto';

export interface SkinportSyncJobData {
  readonly trigger: SourceSyncTrigger;
  readonly mode: SourceSyncMode;
  readonly requestedAt: string;
  readonly force?: boolean;
  readonly externalJobId?: string;
}

export interface SkinportSaleFeedEnvelopeDto {
  readonly event: 'saleFeed';
  readonly payload: SkinportSaleFeedEventDto;
}

export interface SkinportSaleFeedJobData {
  readonly payload: SkinportSaleFeedEnvelopeDto;
  readonly observedAt: string;
}
