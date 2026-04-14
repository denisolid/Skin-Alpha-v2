import type { ArchiveEntityType } from '@prisma/client';

import type { SourceAdapterKey } from '../domain/source-adapter.types';

export interface SourceRawPayloadDto {
  readonly source: SourceAdapterKey;
  readonly endpointName: string;
  readonly observedAt: Date;
  readonly payload: unknown;
  readonly sourceObservedAt?: Date;
  readonly externalId?: string;
  readonly entityType?: ArchiveEntityType;
  readonly contentType?: string;
  readonly httpStatus?: number;
  readonly jobRunId?: string;
  readonly fetchJobId?: string;
  readonly sourceListingId?: string;
  readonly schemaFingerprint?: string;
  readonly requestFingerprint?: string;
  readonly requestMeta?: Record<string, unknown>;
  readonly responseMeta?: Record<string, unknown>;
  readonly cursor?: Record<string, unknown>;
  readonly windowStart?: Date;
  readonly windowEnd?: Date;
}
