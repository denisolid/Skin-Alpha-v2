import type { ItemCategory, Prisma, SourceKind } from '@prisma/client';

import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';

export const MARKET_READ_REPOSITORY = Symbol('MARKET_READ_REPOSITORY');

export interface MarketStateSourceRecord {
  readonly sourceId: string;
  readonly sourceCode: SourceAdapterKey;
  readonly sourceName: string;
  readonly sourceKind: SourceKind;
  readonly sourceMetadata: Prisma.JsonValue | null;
  readonly representativeListing: {
    readonly id: string;
    readonly externalListingId: string;
    readonly title: string;
    readonly listingUrl?: string | null;
    readonly attributes?: Prisma.JsonValue | null;
  } | null;
  readonly latestSnapshotId?: string | null;
  readonly currencyCode: string;
  readonly lowestAskGross?: Prisma.Decimal | null;
  readonly highestBidGross?: Prisma.Decimal | null;
  readonly listingCount?: number | null;
  readonly observedAt: Date;
  readonly lastSyncedAt: Date;
  readonly confidence?: Prisma.Decimal | null;
  readonly latestSnapshot?: {
    readonly id: string;
    readonly currencyCode: string;
    readonly lowestAskGross?: Prisma.Decimal | null;
    readonly highestBidGross?: Prisma.Decimal | null;
    readonly listingCount?: number | null;
    readonly observedAt: Date;
    readonly confidence?: Prisma.Decimal | null;
    readonly rawPayloadArchiveId?: string | null;
  } | null;
}

export interface MarketStateVariantRecord {
  readonly canonicalItemId: string;
  readonly canonicalDisplayName: string;
  readonly category: ItemCategory;
  readonly itemVariantId: string;
  readonly variantKey: string;
  readonly variantDisplayName: string;
  readonly variantMetadata: Prisma.JsonValue | null;
  readonly marketStates: readonly MarketStateSourceRecord[];
}

export interface MarketSnapshotRecord {
  readonly snapshotId: string;
  readonly sourceId: string;
  readonly sourceCode: SourceAdapterKey;
  readonly sourceName: string;
  readonly sourceKind: SourceKind;
  readonly sourceMetadata: Prisma.JsonValue | null;
  readonly currencyCode: string;
  readonly lowestAskGross?: Prisma.Decimal | null;
  readonly highestBidGross?: Prisma.Decimal | null;
  readonly listingCount?: number | null;
  readonly observedAt: Date;
  readonly confidence?: Prisma.Decimal | null;
  readonly rawPayloadArchiveId?: string | null;
}

export interface MarketReadRepository {
  findVariantRecord(
    itemVariantId: string,
  ): Promise<MarketStateVariantRecord | null>;
  findVariantRecords(
    itemVariantIds: readonly string[],
  ): Promise<readonly MarketStateVariantRecord[]>;
  findVariantRecordsByCanonicalItem(
    canonicalItemId: string,
  ): Promise<readonly MarketStateVariantRecord[]>;
  findVariantSnapshotHistory(
    itemVariantId: string,
    limit: number,
  ): Promise<readonly MarketSnapshotRecord[]>;
  findVariantSnapshotHistories(
    itemVariantIds: readonly string[],
    limit: number,
  ): Promise<ReadonlyMap<string, readonly MarketSnapshotRecord[]>>;
}
