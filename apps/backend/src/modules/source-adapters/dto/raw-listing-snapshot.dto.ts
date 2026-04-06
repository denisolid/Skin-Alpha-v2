import type { SourceAdapterKey } from '../domain/source-adapter.types';

export interface RawListingSnapshotDto {
  readonly source: SourceAdapterKey;
  readonly externalListingId: string;
  readonly sourceItemId: string;
  readonly capturedAt: Date;
  readonly title: string;
  readonly currency: string;
  readonly priceMinor: number;
  readonly rawPayload: Record<string, unknown>;
}
