import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

import { GetOpportunityEngineQueryDto } from '../../opportunities/dto/get-opportunity-engine.query.dto';

export class GetDiagnosticsRejectReasonsQueryDto extends GetOpportunityEngineQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25)
  top?: number;
}
