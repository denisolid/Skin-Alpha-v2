import type { Prisma } from '@prisma/client';

import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';

export const MARKET_STATE_WRITE_REPOSITORY = Symbol(
  'MARKET_STATE_WRITE_REPOSITORY',
);

export interface MarketStateWriteSourceRecord {
  readonly id: string;
  readonly code: SourceAdapterKey;
}

export interface AppendSnapshotAndProjectLatestStateInput {
  readonly sourceId: string;
  readonly sourceCode: SourceAdapterKey;
  readonly canonicalItemId: string;
  readonly itemVariantId: string;
  readonly rawPayloadArchiveId?: string;
  readonly currencyCode: string;
  readonly lowestAskGross?: Prisma.Decimal | null;
  readonly highestBidGross?: Prisma.Decimal | null;
  readonly lastTradeGross?: Prisma.Decimal | null;
  readonly average24hGross?: Prisma.Decimal | null;
  readonly listingCount?: number;
  readonly saleCount24h?: number;
  readonly sampleSize?: number;
  readonly confidence?: Prisma.Decimal | null;
  readonly liquidityScore?: Prisma.Decimal | null;
  readonly observedAt: Date;
}

export interface LatestMarketSnapshotProjectionRecord {
  readonly sourceId: string;
  readonly sourceCode: SourceAdapterKey;
  readonly canonicalItemId: string;
  readonly itemVariantId: string;
  readonly snapshotId: string;
  readonly rawPayloadArchiveId?: string | null;
  readonly currencyCode: string;
  readonly lowestAskGross?: Prisma.Decimal | null;
  readonly highestBidGross?: Prisma.Decimal | null;
  readonly lastTradeGross?: Prisma.Decimal | null;
  readonly average24hGross?: Prisma.Decimal | null;
  readonly listingCount?: number | null;
  readonly saleCount24h?: number | null;
  readonly confidence?: Prisma.Decimal | null;
  readonly observedAt: Date;
}

export interface MarketStateProjectionRecord {
  readonly sourceId: string;
  readonly sourceCode: SourceAdapterKey;
  readonly canonicalItemId: string;
  readonly itemVariantId: string;
  readonly marketStateId: string;
  readonly latestSnapshotId: string;
  readonly observedAt: Date;
  readonly snapshotCreated: boolean;
  readonly unchangedProjectionSkipped: boolean;
  readonly rawPayloadArchiveId?: string | null;
}

export interface RefreshLatestMarketStateHeartbeatInput {
  readonly sourceId: string;
  readonly sourceCode: SourceAdapterKey;
  readonly equivalentRawPayloadArchiveId: string;
  readonly observedAt: Date;
}

export interface RefreshLatestMarketStateHeartbeatForVariantsInput {
  readonly sourceId: string;
  readonly sourceCode: SourceAdapterKey;
  readonly itemVariantIds: readonly string[];
  readonly observedAt: Date;
}

export interface RefreshedMarketStateHeartbeatRecord {
  readonly sourceId: string;
  readonly sourceCode: SourceAdapterKey;
  readonly canonicalItemId: string;
  readonly itemVariantId: string;
  readonly marketStateId: string;
  readonly latestSnapshotId: string | null;
  readonly observedAt: Date;
}

export interface MarketStateWriteRepository {
  findSourceByCode(
    sourceCode: SourceAdapterKey,
  ): Promise<MarketStateWriteSourceRecord | null>;
  appendSnapshotAndProjectLatestState(
    input: AppendSnapshotAndProjectLatestStateInput,
  ): Promise<MarketStateProjectionRecord>;
  findLatestSnapshotsForProjection(): Promise<
    readonly LatestMarketSnapshotProjectionRecord[]
  >;
  projectLatestStateFromSnapshot(
    snapshot: LatestMarketSnapshotProjectionRecord,
  ): Promise<MarketStateProjectionRecord>;
  refreshLatestStateHeartbeat(
    input: RefreshLatestMarketStateHeartbeatInput,
  ): Promise<readonly RefreshedMarketStateHeartbeatRecord[]>;
  refreshLatestStateHeartbeatForVariants(
    input: RefreshLatestMarketStateHeartbeatForVariantsInput,
  ): Promise<readonly RefreshedMarketStateHeartbeatRecord[]>;
}
