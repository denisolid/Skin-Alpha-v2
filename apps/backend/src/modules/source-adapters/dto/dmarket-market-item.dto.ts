export interface DMarketPriceDto {
  readonly DMC?: string;
  readonly USD?: string;
}

export interface DMarketRecommendedPriceDto {
  readonly d3?: DMarketPriceDto;
  readonly d7?: DMarketPriceDto;
  readonly d7Plus?: DMarketPriceDto;
}

export interface DMarketStickerDto {
  readonly image?: string;
  readonly name?: string;
  readonly type?: string;
}

export interface DMarketOwnerDetailsDto {
  readonly avatar?: string;
  readonly id?: string;
  readonly wallet?: string;
}

export interface DMarketExtraDto {
  readonly category?: string;
  readonly categoryPath?: string;
  readonly class?: readonly string[];
  readonly collection?: readonly string[];
  readonly exterior?: string;
  readonly floatValue?: number;
  readonly gameId?: string;
  readonly grade?: string;
  readonly groupId?: string;
  readonly inspectInGame?: string;
  readonly isNew?: boolean;
  readonly itemType?: string;
  readonly linkId?: string;
  readonly name?: string;
  readonly nameColor?: string;
  readonly offerId?: string;
  readonly phase?: string;
  readonly paintSeed?: number;
  readonly quality?: string;
  readonly rarity?: string;
  readonly serialNumber?: number;
  readonly stickers?: readonly DMarketStickerDto[];
  readonly subscribers?: number;
  readonly tagName?: string;
  readonly tradable?: boolean;
  readonly tradeLock?: number;
  readonly tradeLockDuration?: number;
  readonly type?: string;
  readonly videos?: number;
  readonly viewAtSteam?: string;
  readonly withdrawable?: boolean;
}

export interface DMarketMarketItemDto {
  readonly amount?: number;
  readonly classId?: string;
  readonly createdAt?: number;
  readonly description?: string;
  readonly discount?: number;
  readonly extra?: DMarketExtraDto;
  readonly extraDoc?: string;
  readonly gameId?: string;
  readonly gameType?: string;
  readonly image?: string;
  readonly inMarket?: boolean;
  readonly instantPrice?: DMarketPriceDto;
  readonly instantTargetId?: string;
  readonly itemId?: string;
  readonly lockStatus?: boolean;
  readonly owner?: string;
  readonly ownerDetails?: DMarketOwnerDetailsDto;
  readonly ownersBlockchainId?: string;
  readonly price?: DMarketPriceDto;
  readonly recommendedPrice?: DMarketRecommendedPriceDto;
  readonly slug?: string;
  readonly status?: string;
  readonly suggestedPrice?: DMarketPriceDto;
  readonly title?: string;
  readonly type?: string;
}

export interface DMarketRateLimitSnapshotDto {
  readonly endpoint: 'market-items';
  readonly limit?: number;
  readonly remaining?: number;
  readonly resetAt?: string;
  readonly retryAfterSeconds?: number;
  readonly headers?: Record<string, string>;
}

export interface DMarketMarketItemsEnvelopeDto {
  readonly cursor?: string;
  readonly total?: number;
  readonly objects: readonly DMarketMarketItemDto[];
  readonly rateLimit?: DMarketRateLimitSnapshotDto;
}
