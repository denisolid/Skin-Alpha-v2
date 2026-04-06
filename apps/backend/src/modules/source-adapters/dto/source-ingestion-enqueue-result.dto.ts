import type { SourceAdapterKey } from '../domain/source-adapter.types';

export interface SourceIngestionEnqueueResultDto {
  readonly queueName: string;
  readonly jobName: string;
  readonly jobId?: string;
  readonly source: SourceAdapterKey;
  readonly endpointName: string;
  readonly observedAt: Date;
}
