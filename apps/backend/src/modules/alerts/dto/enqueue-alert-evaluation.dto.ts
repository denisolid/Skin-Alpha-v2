import { IsOptional, IsUUID } from 'class-validator';

export class EnqueueAlertEvaluationDto {
  @IsOptional()
  @IsUUID('4')
  ruleId?: string;

  @IsOptional()
  @IsUUID('4')
  userId?: string;
}
