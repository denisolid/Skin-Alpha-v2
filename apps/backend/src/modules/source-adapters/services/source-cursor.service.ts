import {
  IngestionFailureClass,
  SyncStatus,
  SyncType,
  type Prisma,
} from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { SourceAdapterKey } from '../domain/source-adapter.types';
import { SourceRecordService } from './source-record.service';

interface UpsertCursorStateInput {
  readonly source: SourceAdapterKey;
  readonly syncType: SyncType;
  readonly status: SyncStatus;
  readonly cursor?: Prisma.InputJsonValue;
  readonly segmentKey?: string;
  readonly failureClass?: IngestionFailureClass;
  readonly metadata?: Prisma.InputJsonValue;
  readonly lastSuccessAt?: Date;
  readonly lastFailureAt?: Date;
}

@Injectable()
export class SourceCursorService {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(SourceRecordService)
    private readonly sourceRecordService: SourceRecordService,
  ) {}

  async upsertCursorState(input: UpsertCursorStateInput): Promise<void> {
    const source = await this.sourceRecordService.resolveByKey(input.source);
    const now = new Date();

    await this.prismaService.sourceCursorState.upsert({
      where: {
        sourceId_syncType_segmentKey: {
          sourceId: source.id,
          syncType: input.syncType,
          segmentKey: input.segmentKey ?? 'default',
        },
      },
      create: {
        sourceId: source.id,
        syncType: input.syncType,
        segmentKey: input.segmentKey ?? 'default',
        status: input.status,
        ...(input.cursor ? { cursor: input.cursor } : {}),
        lastFetchedAt: now,
        ...(input.lastSuccessAt ? { lastSuccessAt: input.lastSuccessAt } : {}),
        ...(input.lastFailureAt ? { lastFailureAt: input.lastFailureAt } : {}),
        ...(input.failureClass ? { failureClass: input.failureClass } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
      },
      update: {
        status: input.status,
        ...(input.cursor ? { cursor: input.cursor } : {}),
        lastFetchedAt: now,
        ...(input.lastSuccessAt ? { lastSuccessAt: input.lastSuccessAt } : {}),
        ...(input.lastFailureAt ? { lastFailureAt: input.lastFailureAt } : {}),
        ...(input.failureClass ? { failureClass: input.failureClass } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
      },
    });
  }
}
