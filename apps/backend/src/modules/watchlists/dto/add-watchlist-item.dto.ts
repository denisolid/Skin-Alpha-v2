import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import {
  SOURCE_ADAPTER_KEYS,
  type SourceAdapterKey,
} from '../../source-adapters/domain/source-adapter.types';

export class AddWatchlistItemDto {
  @IsUUID('4')
  itemVariantId!: string;

  @IsOptional()
  @IsEnum(SOURCE_ADAPTER_KEYS)
  sourceCode?: SourceAdapterKey;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  scopeKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
