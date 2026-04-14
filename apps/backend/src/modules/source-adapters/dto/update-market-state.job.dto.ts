import type { SourceAdapterKey } from '../domain/source-adapter.types';
import type { NormalizedMarketStateDto } from './normalized-market-state.dto';

export interface UpdateMarketStateJobMarketStateData
  extends Omit<NormalizedMarketStateDto, 'capturedAt'> {
  readonly capturedAt: Date | string;
}

export interface UpdateMarketStateJobData {
  readonly rawPayloadArchiveId: string;
  readonly source: SourceAdapterKey;
  readonly marketStates: readonly UpdateMarketStateJobMarketStateData[];
}
