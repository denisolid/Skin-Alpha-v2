import { ItemCategory } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

import {
  SCANNER_ITEM_TIERS,
  type ScannerItemTier,
} from '../domain/item-tier.model';

function toBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalizedValue = value.trim().toLowerCase();

    if (normalizedValue === 'true') {
      return true;
    }

    if (normalizedValue === 'false') {
      return false;
    }
  }

  return Boolean(value);
}

export class GetOpportunityEngineQueryDto {
  @IsOptional()
  @IsEnum(SCANNER_ITEM_TIERS)
  tier?: ScannerItemTier;

  @IsOptional()
  @IsEnum(ItemCategory)
  category?: ItemCategory;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(40)
  maxPairsPerItem?: number;

  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  includeRejected?: boolean;
}

export class GetVariantOpportunityEngineQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(40)
  maxPairs?: number;

  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  includeRejected?: boolean;
}
