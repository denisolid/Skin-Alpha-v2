import type { SourceAdapterKey } from '../domain/source-adapter.types';

export interface NormalizeSourcePayloadJobData {
  readonly rawPayloadArchiveId: string;
  readonly source: SourceAdapterKey;
}
