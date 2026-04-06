import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import {
  SOURCE_ADAPTER_KEYS,
  type SourceAdapterKey,
} from '../../source-adapters/domain/source-adapter.types';

export class AlertDeliveryChannelsInputDto {
  @IsOptional()
  @IsBoolean()
  internal?: boolean;

  @IsOptional()
  @IsBoolean()
  email?: boolean;

  @IsOptional()
  @IsBoolean()
  webhook?: boolean;

  @IsOptional()
  @IsUrl({
    require_tld: false,
  })
  @MaxLength(500)
  webhookUrl?: string;
}

export class CreateAlertRuleDto {
  @IsUUID('4')
  itemVariantId!: string;

  @IsOptional()
  @IsUUID('4')
  watchlistId?: string;

  @IsOptional()
  @IsUUID('4')
  watchlistItemId?: string;

  @IsOptional()
  @IsEnum(SOURCE_ADAPTER_KEYS)
  sourceCode?: SourceAdapterKey;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minSpread?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  minConfidence?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(7 * 24 * 60 * 60)
  cooldownSeconds?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => AlertDeliveryChannelsInputDto)
  channels?: AlertDeliveryChannelsInputDto;
}
