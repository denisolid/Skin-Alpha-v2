import type { ArchiveEntityType } from '@prisma/client';

import type { SourceAdapterKey } from '../domain/source-adapter.types';

export interface ArchivedRawPayloadDto {
  readonly id: string;
  readonly sourceId: string;
  readonly source: SourceAdapterKey;
  readonly endpointName: string;
  readonly externalId?: string;
  readonly observedAt: Date;
  readonly entityType: ArchiveEntityType;
  readonly entityId: string;
  readonly payload: unknown;
  readonly payloadHash: string;
  readonly contentType?: string;
  readonly httpStatus?: number;
  readonly fetchedAt: Date;
}
