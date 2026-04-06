import type { SourceAdapterKey } from '../domain/source-adapter.types';
import type { NormalizedMarketStateDto } from './normalized-market-state.dto';

export interface UpdateMarketStateJobData {
  readonly rawPayloadArchiveId: string;
  readonly source: SourceAdapterKey;
  readonly marketStates: readonly NormalizedMarketStateDto[];
}
