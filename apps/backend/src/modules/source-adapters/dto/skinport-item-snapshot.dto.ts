export interface SkinportItemSnapshotDto {
  readonly market_hash_name: string;
  readonly currency: string;
  readonly suggested_price: number | null;
  readonly item_page: string;
  readonly market_page: string;
  readonly min_price: number | null;
  readonly max_price: number | null;
  readonly mean_price: number | null;
  readonly median_price: number | null;
  readonly quantity: number;
  readonly created_at: number;
  readonly updated_at: number;
}
