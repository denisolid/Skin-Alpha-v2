import type { BackupAggregatorTargetDto } from './backup-aggregator.dto';

export const CS2SH_BACKUP_SOURCE_KEYS = [
  'steam',
  'skinport',
  'csfloat',
  'buff',
  'youpin',
  'c5game',
] as const;

export type Cs2ShBackupSourceKey = (typeof CS2SH_BACKUP_SOURCE_KEYS)[number];

export interface Cs2ShQuoteDto {
  readonly ask?: number;
  readonly ask_volume?: number;
  readonly updated_at?: string;
  readonly collected_at?: string;
}

export interface Cs2ShLatestPriceItemDto {
  readonly market_hash_name?: string;
  readonly ask?: number;
  readonly ask_volume?: number;
  readonly updated_at?: string;
  readonly collected_at?: string;
  readonly sources?: Record<string, Cs2ShQuoteDto | null>;
  readonly steam?: Cs2ShQuoteDto | null;
  readonly skinport?: Cs2ShQuoteDto | null;
  readonly csfloat?: Cs2ShQuoteDto | null;
  readonly buff?: Cs2ShQuoteDto | null;
  readonly youpin?: Cs2ShQuoteDto | null;
  readonly c5game?: Cs2ShQuoteDto | null;
}

export interface Cs2ShLatestPricesResponseDto {
  readonly response_time?: string;
  readonly quota?: {
    readonly remaining?: number;
    readonly resets_at?: string;
  };
  readonly items?: Record<string, Cs2ShLatestPriceItemDto | null>;
}

export interface Cs2ShLatestPricesRequestDto {
  readonly items: readonly string[];
  readonly sources?: readonly string[];
}

export interface Cs2ShArchivedBatchPayloadDto {
  readonly batchId: string;
  readonly requestedAt: string;
  readonly observedAt: string;
  readonly targets: readonly BackupAggregatorTargetDto[];
  readonly selectedSources: readonly string[];
  readonly response: Cs2ShLatestPricesResponseDto;
}
