import type { SourceAdapterSummaryDto } from './source-adapter-summary.dto';

export interface SourceAdapterFrameworkDto {
  readonly generatedAt: Date;
  readonly adapters: readonly SourceAdapterSummaryDto[];
}
