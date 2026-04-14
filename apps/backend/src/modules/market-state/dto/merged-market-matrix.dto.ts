import type { ItemCategory } from '@prisma/client';

import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';
import type { MarketFreshnessDto } from './market-freshness.dto';

export const MARKET_FETCH_MODES = [
  'live',
  'snapshot',
  'fallback',
  'backup',
] as const;

export type MarketFetchMode = (typeof MARKET_FETCH_MODES)[number];

export const MARKET_CONFLICT_STATES = [
  'insufficient-data',
  'aligned',
  'divergent',
  'conflicted',
] as const;

export type MarketConflictState = (typeof MARKET_CONFLICT_STATES)[number];

export interface MergedMarketVariantIdentityDto {
  readonly marketHashName?: string;
  readonly exterior?: string;
  readonly phaseLabel?: string;
  readonly phaseFamily: 'vanilla' | 'standard' | 'doppler' | 'gamma-doppler';
  readonly phaseConfidence: number;
  readonly stattrak: boolean;
  readonly souvenir: boolean;
  readonly isVanilla: boolean;
  readonly isDoppler: boolean;
  readonly isGammaDoppler: boolean;
  readonly patternRelevant: boolean;
  readonly floatRelevant: boolean;
  readonly patternSensitivity: 'none' | 'supported' | 'required';
  readonly floatSensitivity: 'none' | 'supported' | 'required';
  readonly mappingConfidence: number;
  readonly defIndex?: number;
  readonly paintIndex?: number;
}

export interface MergedMarketRowIdentityDto {
  readonly representativeListingId?: string;
  readonly externalListingId?: string;
  readonly title?: string;
  readonly condition?: string;
  readonly phase?: string;
  readonly paintSeed?: number;
  readonly wearFloat?: number;
  readonly isStatTrak?: boolean;
  readonly isSouvenir?: boolean;
  readonly stickerCount?: number;
  readonly hasSellerMetadata: boolean;
  readonly hasScmHints: boolean;
}

export interface MergedMarketMatrixRowDto {
  readonly source: SourceAdapterKey;
  readonly sourceName: string;
  readonly marketUrl?: string;
  readonly listingUrl?: string;
  readonly ask?: number;
  readonly bid?: number;
  readonly listedQty?: number;
  readonly observedAt: Date;
  readonly freshness: MarketFreshnessDto;
  readonly confidence: number;
  readonly sourceConfidence: number;
  readonly fetchMode: MarketFetchMode;
  readonly currency: string;
  readonly snapshotId?: string;
  readonly rawPayloadArchiveId?: string;
  readonly agreementState?: Exclude<MarketConflictState, 'insufficient-data'>;
  readonly deviationFromConsensusPercent?: number;
  readonly identity?: MergedMarketRowIdentityDto;
}

export interface MarketConflictSummaryDto {
  readonly state: MarketConflictState;
  readonly comparedSourceCount: number;
  readonly usableSourceCount: number;
  readonly consensusAsk?: number;
  readonly minAsk?: number;
  readonly maxAsk?: number;
  readonly spreadPercent?: number;
}

export interface MergedMarketMatrixDto {
  readonly generatedAt: Date;
  readonly canonicalItemId: string;
  readonly canonicalDisplayName: string;
  readonly category: ItemCategory;
  readonly itemVariantId: string;
  readonly variantDisplayName: string;
  readonly variantIdentity: MergedMarketVariantIdentityDto;
  readonly rows: readonly MergedMarketMatrixRowDto[];
  readonly conflict: MarketConflictSummaryDto;
}

export interface CanonicalMarketMatrixDto {
  readonly generatedAt: Date;
  readonly canonicalItemId: string;
  readonly canonicalDisplayName: string;
  readonly category: ItemCategory;
  readonly matrices: readonly MergedMarketMatrixDto[];
}
