import type { ItemCategory } from '@prisma/client';

import type {
  SourceAdapterKey,
  SourceSyncMode,
} from '../../source-adapters/domain/source-adapter.types';
import type { ScannerItemTier } from '../domain/item-tier.model';

export interface ScannerUniverseSignalScoresDto {
  readonly liquidity: number;
  readonly priceMovement: number;
  readonly sourceActivity: number;
  readonly opportunityFrequency: number;
  readonly composite: number;
}

export interface ScannerUniverseOpportunityMetricsDto {
  readonly openCount: number;
  readonly recent7dCount: number;
  readonly recent30dCount: number;
}

export interface ScannerUniverseSourceMetricsDto {
  readonly totalSourceCount: number;
  readonly usableSourceCount: number;
  readonly freshSourceCount: number;
  readonly backupSourceCount: number;
}

export interface ScannerUniversePollingSourcePlanDto {
  readonly source: SourceAdapterKey;
  readonly sourceName: string;
  readonly syncMode: SourceSyncMode;
  readonly pollIntervalSeconds: number;
  readonly priorityWeight: number;
  readonly reason: string;
}

export interface ScannerUniverseManualOverrideDto {
  readonly tier: 'hot';
  readonly createdAt: Date;
  readonly createdByUserId: string;
  readonly note?: string;
  readonly expiresAt?: Date;
}

export interface ScannerUniverseItemDto {
  readonly canonicalItemId: string;
  readonly canonicalDisplayName: string;
  readonly itemVariantId: string;
  readonly variantDisplayName: string;
  readonly category: ItemCategory;
  readonly itemType: string;
  readonly tier: ScannerItemTier;
  readonly compositeScore: number;
  readonly signals: ScannerUniverseSignalScoresDto;
  readonly opportunityMetrics: ScannerUniverseOpportunityMetricsDto;
  readonly sourceMetrics: ScannerUniverseSourceMetricsDto;
  readonly pollingPlan: readonly ScannerUniversePollingSourcePlanDto[];
  readonly promotionReasons: readonly string[];
  readonly demotionReasons: readonly string[];
  readonly manualOverride?: ScannerUniverseManualOverrideDto;
}

export interface ScannerUniverseSummaryDto {
  readonly hot: number;
  readonly warm: number;
  readonly cold: number;
  readonly overridden: number;
}

export interface ScannerUniverseListDto {
  readonly generatedAt: Date;
  readonly summary: ScannerUniverseSummaryDto;
  readonly items: readonly ScannerUniverseItemDto[];
}

export interface ScannerUniverseOverrideMutationDto {
  readonly itemVariantId: string;
  readonly action: 'set' | 'cleared';
}
