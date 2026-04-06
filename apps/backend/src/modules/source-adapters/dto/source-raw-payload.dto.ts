import type { ArchiveEntityType } from '@prisma/client';

import type { SourceAdapterKey } from '../domain/source-adapter.types';

export interface SourceRawPayloadDto {
  readonly source: SourceAdapterKey;
  readonly endpointName: string;
  readonly observedAt: Date;
  readonly payload: unknown;
  readonly externalId?: string;
  readonly entityType?: ArchiveEntityType;
  readonly contentType?: string;
  readonly httpStatus?: number;
  readonly jobRunId?: string;
  readonly sourceListingId?: string;
}
