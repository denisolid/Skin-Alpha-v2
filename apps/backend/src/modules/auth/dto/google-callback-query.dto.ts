import { IsOptional, IsString, ValidateIf } from 'class-validator';

export class GoogleCallbackQueryDto {
  @ValidateIf((value: GoogleCallbackQueryDto) => !value.error)
  @IsString()
  code!: string;

  @IsString()
  state!: string;

  @IsOptional()
  @IsString()
  error?: string;

  @IsOptional()
  @IsString()
  error_description?: string;
}
