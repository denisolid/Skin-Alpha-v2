export interface WaxpeerMassInfoListingDto {
  readonly price?: number;
  readonly by?: string;
  readonly item_id?: string;
  readonly name?: string;
  readonly steam_price?: number;
  readonly classid?: string;
  readonly image?: string;
  readonly paint_index?: number;
  readonly phase?: string | null;
  readonly float?: number;
  readonly inspect?: string;
  readonly type?: string;
}

export interface WaxpeerMassInfoBucketDto {
  readonly listings: readonly WaxpeerMassInfoListingDto[];
  readonly orders?: readonly unknown[];
  readonly history?: readonly unknown[];
  readonly info?: Record<string, unknown>;
}

export interface WaxpeerRateLimitSnapshotDto {
  readonly endpoint: 'mass-info';
  readonly limit?: number;
  readonly remaining?: number;
  readonly resetAt?: string;
  readonly retryAfterSeconds?: number;
  readonly headers?: Record<string, string>;
}

export interface WaxpeerMassInfoResponseDto {
  readonly success?: boolean;
  readonly msg?: string;
  readonly data: Readonly<Record<string, WaxpeerMassInfoBucketDto>>;
  readonly rateLimit?: WaxpeerRateLimitSnapshotDto;
}
