import { IngestionFailureClass, type Prisma } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { AppLoggerService } from '../../../infrastructure/logging/app-logger.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { SourceAdapterKey } from '../domain/source-adapter.types';
import { SourceRecordService } from './source-record.service';

interface RecordDeadLetterInput {
  readonly source?: SourceAdapterKey;
  readonly fetchJobId?: string;
  readonly rawPayloadArchiveId?: string;
  readonly jobRunId?: string;
  readonly stage: string;
  readonly reason: string;
  readonly failureClass?: IngestionFailureClass;
  readonly payload?: Prisma.InputJsonValue;
  readonly metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class SourceDeadLetterService {
  constructor(
    @Inject(AppLoggerService)
    private readonly logger: AppLoggerService,
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(SourceRecordService)
    private readonly sourceRecordService: SourceRecordService,
  ) {}

  async record(input: RecordDeadLetterInput): Promise<void> {
    const sourceId = input.source
      ? (await this.sourceRecordService.resolveByKey(input.source)).id
      : undefined;

    await this.prismaService.ingestionDeadLetter.create({
      data: {
        ...(sourceId ? { sourceId } : {}),
        ...(input.fetchJobId ? { fetchJobId: input.fetchJobId } : {}),
        ...(input.rawPayloadArchiveId
          ? { rawPayloadArchiveId: input.rawPayloadArchiveId }
          : {}),
        ...(input.jobRunId ? { jobRunId: input.jobRunId } : {}),
        stage: input.stage,
        failureClass: input.failureClass ?? IngestionFailureClass.UNKNOWN,
        reason: input.reason,
        ...(input.payload ? { payload: input.payload } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
      },
    });

    this.logger.error(
      `Recorded dead-letter event for stage ${input.stage}: ${input.reason}`,
      undefined,
      SourceDeadLetterService.name,
    );
  }
}
