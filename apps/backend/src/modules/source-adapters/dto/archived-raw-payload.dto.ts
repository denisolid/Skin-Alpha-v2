import type { ArchiveEntityType } from '@prisma/client';

import type { SourceAdapterKey } from '../domain/source-adapter.types';

export interface ArchivedRawPayloadDto {
  readonly id: string;
  readonly sourceId: string;
  readonly source: SourceAdapterKey;
  readonly fetchJobId?: string;
  readonly jobRunId?: string;
  readonly endpointName: string;
  readonly externalId?: string;
  readonly observedAt: Date;
  readonly sourceObservedAt?: Date;
  readonly entityType: ArchiveEntityType;
  readonly entityId: string;
  readonly payload: unknown;
  readonly payloadHash: string;
  readonly schemaFingerprint?: string;
  readonly requestFingerprint?: string;
  readonly requestMeta?: Record<string, unknown>;
  readonly responseMeta?: Record<string, unknown>;
  readonly cursor?: Record<string, unknown>;
  readonly windowStart?: Date;
  readonly windowEnd?: Date;
  readonly contentType?: string;
  readonly httpStatus?: number;
  readonly fetchedAt: Date;
  readonly archivedAt: Date;
}
