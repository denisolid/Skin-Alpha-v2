import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateSchemeDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  feedEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  liveEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  alertsEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(-1000)
  @Max(1000)
  priority?: number;

  @IsOptional()
  @IsObject()
  scope?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  selection?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  thresholds?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  validation?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  view?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  alertSettings?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  liveOptions?: Record<string, unknown>;
}
