import type { SourceIngestionEnqueueResultDto } from '../dto/source-ingestion-enqueue-result.dto';
import type { SourceRawPayloadDto } from '../dto/source-raw-payload.dto';

export interface SourceIngestionUseCase {
  enqueueRawPayload(
    input: SourceRawPayloadDto,
  ): Promise<SourceIngestionEnqueueResultDto>;
}
