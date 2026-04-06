import { ItemCategory } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  SCANNER_ITEM_TIERS,
  type ScannerItemTier,
} from '../domain/item-tier.model';

export const OPPORTUNITY_FEED_SORT_FIELDS = [
  'expected_profit',
  'confidence',
  'freshness',
  'liquidity',
] as const;

export type OpportunityFeedSortField =
  (typeof OPPORTUNITY_FEED_SORT_FIELDS)[number];

export const OPPORTUNITY_FEED_SORT_DIRECTIONS = ['asc', 'desc'] as const;

export type OpportunityFeedSortDirection =
  (typeof OPPORTUNITY_FEED_SORT_DIRECTIONS)[number];

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalizedValue = value.trim();

  return normalizedValue.length > 0 ? normalizedValue : undefined;
}

export class GetOpportunityFeedQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^[a-z-]+->[a-z-]+$/)
  sourcePair?: string;

  @IsOptional()
  @IsEnum(ItemCategory)
  category?: ItemCategory;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minProfit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  minConfidence?: number;

  @IsOptional()
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsString()
  @MaxLength(120)
  itemType?: string;

  @IsOptional()
  @IsEnum(SCANNER_ITEM_TIERS)
  tier?: ScannerItemTier;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @IsEnum(OPPORTUNITY_FEED_SORT_FIELDS)
  sortBy?: OpportunityFeedSortField;

  @IsOptional()
  @IsEnum(OPPORTUNITY_FEED_SORT_DIRECTIONS)
  sortDirection?: OpportunityFeedSortDirection;
}

export class GetOpportunityDetailQueryDto {
  @IsString()
  @Matches(/^[a-z-]+->[a-z-]+$/)
  sourcePair!: string;
}
