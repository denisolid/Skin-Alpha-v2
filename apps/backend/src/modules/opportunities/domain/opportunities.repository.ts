import type {
  ItemCategory,
  OpportunityStatus,
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

export interface ScannerUniverseOpportunityRecord {
  readonly status: OpportunityStatus;
  readonly detectedAt: Date;
  readonly confidence: Prisma.Decimal;
}

export interface ScannerUniverseCandidateRecord {
  readonly canonicalItemId: string;
  readonly canonicalDisplayName: string;
  readonly category: ItemCategory;
  readonly itemType: string;
  readonly itemVariantId: string;
  readonly variantDisplayName: string;
  readonly marketStates: readonly ScannerUniverseMarketStateRecord[];
  readonly opportunities: readonly ScannerUniverseOpportunityRecord[];
}

export interface FindScannerUniverseCandidatesInput {
  readonly limit: number;
  readonly category?: ItemCategory;
  readonly itemVariantIds?: readonly string[];
}

export interface OpportunitiesRepository {
  findScannerUniverseCandidates(
    input: FindScannerUniverseCandidatesInput,
  ): Promise<readonly ScannerUniverseCandidateRecord[]>;
  findScannerUniverseVariant(
    itemVariantId: string,
  ): Promise<ScannerUniverseCandidateRecord | null>;
}
