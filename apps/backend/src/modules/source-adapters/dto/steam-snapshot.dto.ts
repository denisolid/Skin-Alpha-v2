export interface SteamSnapshotTargetDto {
  readonly canonicalItemId: string;
  readonly itemVariantId: string;
  readonly marketHashName: string;
  readonly priorityScore: number;
  readonly priorityReason: string;
  readonly steamObservedAt?: string;
}

export interface SteamPriceOverviewDto {
  readonly success: boolean;
  readonly lowest_price?: string;
  readonly median_price?: string;
  readonly volume?: string;
}

export interface SteamSnapshotFetchedItemDto {
  readonly target: SteamSnapshotTargetDto;
  readonly fetchedAt: string;
  readonly httpStatus: number;
  readonly priceOverview?: SteamPriceOverviewDto;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

export interface SteamSnapshotBatchPayloadDto {
  readonly batchId: string;
  readonly requestedAt: string;
  readonly observedAt: string;
  readonly items: readonly SteamSnapshotFetchedItemDto[];
  readonly stalePolicy: {
    readonly staleAfterMinutes: number;
    readonly maxStaleMinutes: number;
  };
}

export interface SteamSnapshotBatchPlanDto {
  readonly batchId: string;
  readonly targets: readonly SteamSnapshotTargetDto[];
}

export interface SteamSnapshotFreshnessDto {
  readonly lastSuccessfulSyncAt?: Date;
  readonly lastGoodSnapshotAt?: Date;
  readonly lagMs?: number;
  readonly fresh: boolean;
  readonly fallbackUsable: boolean;
  readonly confidencePenalty: number;
}
