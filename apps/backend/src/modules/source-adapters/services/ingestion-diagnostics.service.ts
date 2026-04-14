import { HealthStatus, type Prisma } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { AppLoggerService } from '../../../infrastructure/logging/app-logger.service';
import type { SourceAdapterKey } from '../domain/source-adapter.types';
import { SourceOperationsService } from './source-operations.service';

interface RecordStageMetricInput {
  readonly source: SourceAdapterKey;
  readonly stage: string;
  readonly status: HealthStatus;
  readonly latencyMs?: number;
  readonly queueDepth?: number;
  readonly details?: Prisma.InputJsonValue;
}

@Injectable()
export class IngestionDiagnosticsService {
  constructor(
    @Inject(AppLoggerService)
    private readonly logger: AppLoggerService,
    @Inject(SourceOperationsService)
    private readonly sourceOperationsService: SourceOperationsService,
  ) {}

  async recordStageMetric(input: RecordStageMetricInput): Promise<void> {
    await this.sourceOperationsService.recordHealthMetric({
      source: input.source,
      status: input.status,
      ...(input.latencyMs !== undefined ? { latencyMs: input.latencyMs } : {}),
      ...(input.queueDepth !== undefined ? { queueDepth: input.queueDepth } : {}),
      details: {
        stage: input.stage,
        ...(input.details && typeof input.details === 'object'
          ? (input.details as Prisma.InputJsonObject)
          : {}),
      } satisfies Prisma.InputJsonObject,
    });

    this.logger.debug(
      `Recorded ingestion metric for ${input.source}:${input.stage}.`,
      IngestionDiagnosticsService.name,
    );
  }
}
