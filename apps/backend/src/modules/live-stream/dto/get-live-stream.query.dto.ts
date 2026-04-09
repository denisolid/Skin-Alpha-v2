import { Transform } from 'class-transformer';
import { ArrayUnique, IsArray, IsOptional, IsUUID } from 'class-validator';

function toStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const values = Array.isArray(value) ? value : [value];
  const normalizedValues = values
    .flatMap((entry) =>
      typeof entry === 'string' ? entry.split(',') : [String(entry)],
    )
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return normalizedValues.length > 0 ? normalizedValues : undefined;
}

export class GetLiveStreamQueryDto {
  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  schemeIds?: string[];
}
