export interface SkinportSalesHistoryWindowDto {
  readonly min: number | null;
  readonly max: number | null;
  readonly avg: number | null;
  readonly median: number | null;
  readonly volume: number;
}

export interface SkinportSalesHistoryDto {
  readonly market_hash_name: string;
  readonly version: string | null;
  readonly currency: string;
  readonly item_page: string;
  readonly market_page: string;
  readonly last_24_hours: SkinportSalesHistoryWindowDto;
  readonly last_7_days: SkinportSalesHistoryWindowDto;
  readonly last_30_days: SkinportSalesHistoryWindowDto;
  readonly last_90_days: SkinportSalesHistoryWindowDto;
}
