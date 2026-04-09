import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class DuplicateSchemeDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsBoolean()
  activate?: boolean;
}
