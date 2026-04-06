import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';

export interface CatalogSourceListingInputDto {
  readonly source: SourceAdapterKey;
  readonly marketHashName: string;
  readonly type?: string | null;
  readonly weapon?: string | null;
  readonly skinName?: string | null;
  readonly exterior?: string | null;
  readonly rarity?: string | number | null;
  readonly isStatTrak?: boolean | null;
  readonly isSouvenir?: boolean | null;
  readonly defIndex?: number | null;
  readonly paintIndex?: number | null;
  readonly phaseHint?: string | null;
}
