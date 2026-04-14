export interface BitSkinsMarketItemDto {
  readonly skin_id?: number;
  readonly name?: string;
  readonly price_min?: number;
  readonly price_max?: number;
  readonly price_avg?: number;
  readonly quantity?: number;
}

export interface BitSkinsRateLimitSnapshotDto {
  readonly endpoint: 'market-insell';
  readonly headers?: Record<string, string>;
}

export interface BitSkinsMarketSnapshotDto {
  readonly list: readonly BitSkinsMarketItemDto[];
  readonly rateLimit?: BitSkinsRateLimitSnapshotDto;
}
