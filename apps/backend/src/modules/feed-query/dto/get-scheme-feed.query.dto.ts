import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

import { GetOpportunityFeedQueryDto } from '../../opportunities/dto/get-opportunity-feed.query.dto';

function toBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();

    if (normalized === 'true') {
      return true;
    }

    if (normalized === 'false') {
      return false;
    }
  }

  return Boolean(value);
}

export class GetSchemeFeedQueryDto extends GetOpportunityFeedQueryDto {
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  hideBlacklisted?: boolean;

  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  hideMuted?: boolean;

  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  pinnedFirst?: boolean;
}
