export interface SkinportSaleFeedSaleDto {
  readonly saleId: number;
  readonly productId: number;
  readonly itemId: number;
  readonly appid: number;
  readonly url?: string;
  readonly marketHashName: string;
  readonly version?: string | null;
  readonly versionType?: string | null;
  readonly suggestedPrice?: number;
  readonly salePrice: number;
  readonly currency: string;
  readonly saleStatus?: string;
  readonly pattern?: number;
  readonly wear?: number;
}

export interface SkinportSaleFeedEventDto {
  readonly eventType: string;
  readonly sales: readonly SkinportSaleFeedSaleDto[];
}
