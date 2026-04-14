import type {
  ItemCategory,
  OpportunityRiskClass,
  Prisma,
  SourceKind,
} from '@prisma/client';

import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';

export const OPPORTUNITIES_REPOSITORY = Symbol('OPPORTUNITIES_REPOSITORY');

export interface ScannerUniverseMarketStateRecord {
  readonly sourceCode: SourceAdapterKey;
  readonly sourceName: string;
  readonly sourceKind: SourceKind;
  readonly sourceMetadata: Prisma.JsonValue | null;
  readonly observedAt: Date;
  readonly confidence?: Prisma.Decimal | null;
  readonly liquidityScore?: Prisma.Decimal | null;
  readonly listingCount?: number | null;
  readonly lowestAskGross?: Prisma.Decimal | null;
  readonly average24hGross?: Prisma.Decimal | null;
  readonly lastTradeGross?: Prisma.Decimal | null;
}

export interface ScannerUniverseCandidateRecord {
  readonly canonicalItemId: string;
  readonly canonicalDisplayName: string;
  readonly category: ItemCategory;
  readonly itemType: string;
  readonly itemVariantId: string;
  readonly variantDisplayName: string;
  readonly marketStates: readonly ScannerUniverseMarketStateRecord[];
}

export interface FindScannerUniverseCandidatesInput {
  readonly limit: number;
  readonly category?: ItemCategory;
  readonly itemVariantIds?: readonly string[];
}

export interface MaterializedOpportunitySourceRecord {
  readonly id: string;
  readonly code: SourceAdapterKey;
  readonly name: string;
  readonly kind: SourceKind;
  readonly metadata: Prisma.JsonValue | null;
}

export interface MaterializedOpportunityRecord {
  readonly id: string;
  readonly canonicalItemId: string;
  readonly itemVariantId: string;
  readonly buySnapshotId: string;
  readonly sellSnapshotId: string;
  readonly riskClass: OpportunityRiskClass;
  readonly spreadAbsolute: Prisma.Decimal;
  readonly spreadPercent: Prisma.Decimal;
  readonly expectedNet: Prisma.Decimal;
  readonly expectedFees?: Prisma.Decimal | null;
  readonly confidence: Prisma.Decimal;
  readonly detectedAt: Date;
  readonly expiresAt?: Date | null;
  readonly notes: Prisma.JsonValue | null;
  readonly canonicalItemDisplayName: string;
  readonly category: ItemCategory;
  readonly canonicalItemWeaponName?: string | null;
  readonly canonicalItemMetadata: Prisma.JsonValue | null;
  readonly itemVariantDisplayName: string;
  readonly itemVariantKey: string;
  readonly itemVariantMetadata: Prisma.JsonValue | null;
  readonly buySource: MaterializedOpportunitySourceRecord;
  readonly sellSource: MaterializedOpportunitySourceRecord;
}

export interface FindMaterializedOpportunitiesInput {
  readonly now: Date;
  readonly detectedAfter: Date;
  readonly category?: ItemCategory;
  readonly itemVariantId?: string;
  readonly itemVariantIds?: readonly string[];
  readonly sourcePair?: {
    readonly buySource: SourceAdapterKey;
    readonly sellSource: SourceAdapterKey;
  };
  readonly minExpectedNet?: number;
  readonly minConfidence?: number;
}

export interface LatestOpportunityRescanRecord {
  readonly completedAt: Date;
  readonly result: Prisma.JsonValue | null;
}

export interface OpportunitiesRepository {
  findScannerUniverseCandidates(
    input: FindScannerUniverseCandidatesInput,
  ): Promise<readonly ScannerUniverseCandidateRecord[]>;
  findOverlapScannerUniverseCandidates(): Promise<
    readonly ScannerUniverseCandidateRecord[]
  >;
  findScannerUniverseVariant(
    itemVariantId: string,
  ): Promise<ScannerUniverseCandidateRecord | null>;
  listMaterializedOpportunities(
    input: FindMaterializedOpportunitiesInput,
  ): Promise<readonly MaterializedOpportunityRecord[]>;
  findLatestMaterializedOpportunity(
    input: FindMaterializedOpportunitiesInput & {
      readonly sourcePair: {
        readonly buySource: SourceAdapterKey;
        readonly sellSource: SourceAdapterKey;
      };
      readonly itemVariantId: string;
    },
  ): Promise<MaterializedOpportunityRecord | null>;
  findLatestOpportunityRescan(): Promise<LatestOpportunityRescanRecord | null>;
}
