export interface CsFloatStickerScmHintDto {
  readonly price?: number;
  readonly volume?: number;
}

export interface CsFloatStickerDto {
  readonly stickerId?: number;
  readonly slot?: number;
  readonly wear?: number;
  readonly name?: string;
  readonly iconUrl?: string;
  readonly scm?: CsFloatStickerScmHintDto;
}

export interface CsFloatScmHintDto {
  readonly price?: number;
  readonly volume?: number;
}

export interface CsFloatSellerStatisticsDto {
  readonly totalTrades?: number;
  readonly successfulTrades?: number;
  readonly medianTradeTimeHours?: number;
}

export interface CsFloatSellerDto {
  readonly id?: string;
  readonly steamId?: string;
  readonly username?: string;
  readonly avatarUrl?: string;
  readonly online?: boolean;
  readonly stallPublic?: boolean;
  readonly statistics?: CsFloatSellerStatisticsDto;
}

export interface CsFloatItemDto {
  readonly assetId: string;
  readonly marketHashName: string;
  readonly inspectLink?: string;
  readonly iconUrl?: string;
  readonly collection?: string;
  readonly itemName?: string;
  readonly wearName?: string;
  readonly rarity?: number;
  readonly quality?: number;
  readonly tradable?: number;
  readonly floatValue?: number;
  readonly paintSeed?: number;
  readonly defIndex?: number;
  readonly paintIndex?: number;
  readonly isStatTrak?: boolean;
  readonly isSouvenir?: boolean;
  readonly stickers?: readonly CsFloatStickerDto[];
  readonly scm?: CsFloatScmHintDto;
}

export interface CsFloatListingDto {
  readonly id: string;
  readonly price: number;
  readonly state?: string;
  readonly type?: string;
  readonly createdAt?: string;
  readonly seller?: CsFloatSellerDto;
  readonly item: CsFloatItemDto;
  readonly minOfferPrice?: number;
  readonly maxOfferDiscount?: number;
  readonly watchers?: number;
}

export interface CsFloatListingsFilterDto {
  readonly marketHashName?: string;
  readonly minPrice?: number;
  readonly maxPrice?: number;
  readonly minFloat?: number;
  readonly maxFloat?: number;
  readonly rarity?: number;
  readonly sortBy?: string;
  readonly limit?: number;
}

export interface CsFloatRateLimitSnapshotDto {
  readonly endpoint: 'listings' | 'listing-detail';
  readonly limit?: number;
  readonly remaining?: number;
  readonly resetAt?: string;
  readonly retryAfterSeconds?: number;
  readonly headers?: Record<string, string>;
}

export interface CsFloatListingsEnvelopeDto {
  readonly listings: readonly CsFloatListingDto[];
  readonly pagination: {
    readonly cursor?: string;
    readonly nextCursor?: string;
    readonly limit: number;
    readonly page: number;
    readonly filters?: CsFloatListingsFilterDto;
  };
  readonly rateLimit?: CsFloatRateLimitSnapshotDto;
}

export interface CsFloatListingDetailEnvelopeDto {
  readonly listing: CsFloatListingDto;
  readonly rateLimit?: CsFloatRateLimitSnapshotDto;
}
