import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';

export const MARKET_STATE_CHANGE_EMITTER = Symbol(
  'MARKET_STATE_CHANGE_EMITTER',
);
export const MARKET_STATE_CHANGED_CHANNEL = 'market-state.changed';

export interface MarketStateChangedEvent {
  readonly source: SourceAdapterKey;
  readonly marketStateId: string;
  readonly latestSnapshotId: string;
  readonly canonicalItemId: string;
  readonly itemVariantId: string;
  readonly observedAt: Date;
  readonly rawPayloadArchiveId?: string | null;
}

export interface MarketStateChangeEmitter {
  emitChanged(
    events: readonly MarketStateChangedEvent[],
  ): Promise<void> | void;
}
