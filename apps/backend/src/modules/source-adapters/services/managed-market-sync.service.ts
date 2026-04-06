import {
  HealthStatus,
  SyncStatus,
  SyncType,
  type Prisma,
} from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { SourceIngestionService } from './source-ingestion.service';
import { SourceOperationsService } from './source-operations.service';
import {
  ManagedMarketHttpClientService,
  ManagedMarketHttpError,
} from './managed-market-http-client.service';
import { ManagedMarketSourceDefinitionsService } from './managed-market-source-definitions.service';
import { ManagedMarketSourceRuntimeService } from './managed-market-source-runtime.service';
import { OverlapAwareSourceUniverseService } from './overlap-aware-source-universe.service';
import type {
  ManagedMarketSourceKey,
  ManagedMarketSyncJobData,
} from '../domain/managed-market-source.types';

@Injectable()
export class ManagedMarketSyncService {
  constructor(
    @Inject(SourceIngestionService)
    private readonly sourceIngestionService: SourceIngestionService,
    @Inject(SourceOperationsService)
    private readonly sourceOperationsService: SourceOperationsService,
    @Inject(ManagedMarketHttpClientService)
    private readonly managedMarketHttpClientService: ManagedMarketHttpClientService,
    @Inject(ManagedMarketSourceDefinitionsService)
    private readonly definitionsService: ManagedMarketSourceDefinitionsService,
    @Inject(ManagedMarketSourceRuntimeService)
    private readonly runtimeService: ManagedMarketSourceRuntimeService,
    @Inject(OverlapAwareSourceUniverseService)
    private readonly overlapAwareSourceUniverseService: OverlapAwareSourceUniverseService,
  ) {}

  async syncSource(
    source: ManagedMarketSourceKey,
    input: ManagedMarketSyncJobData,
  ): Promise<void> {
    const definition = this.definitionsService.get(source);
    const payload = this.serializeJson(input);
    const jobRunId = input.externalJobId
      ? await this.sourceOperationsService.startQueuedJobRun({
          source,
          queueName: definition.queueName,
          jobName: definition.queueName,
          externalJobId: input.externalJobId,
          ...(payload ? { payload } : {}),
        })
      : await this.sourceOperationsService.startJobRun({
          source,
          queueName: definition.queueName,
          jobName: definition.queueName,
          ...(payload ? { payload } : {}),
        });

    try {
      if (!definition.enabled) {
        await this.cancelSync(source, jobRunId, {
          reason: 'source_disabled',
          classification: definition.classification,
        });

        return;
      }

      const circuitBreaker =
        await this.runtimeService.checkCircuitBreaker(source);

      if (!circuitBreaker.allowed) {
        await this.cancelSync(source, jobRunId, {
          reason: 'circuit_breaker_open',
          retryAfterSeconds: circuitBreaker.retryAfterSeconds ?? null,
          consecutiveFailures: circuitBreaker.consecutiveFailures,
        });
        await this.sourceOperationsService.recordHealthMetric({
          source,
          status: HealthStatus.DEGRADED,
          details: {
            reason: 'circuit_breaker_open',
            retryAfterSeconds: circuitBreaker.retryAfterSeconds ?? null,
          } satisfies Prisma.InputJsonValue,
        });

        return;
      }

      const batches =
        await this.overlapAwareSourceUniverseService.selectPriorityBatches({
          source,
          batchBudget: Math.max(1, input.batchBudget ?? definition.batchBudget),
          batchSize: Math.max(1, definition.batchSize),
          staleAfterMs: this.resolveStaleAfterMs(source),
          ...(input.targetItemVariantIds?.length
            ? { targetItemVariantIds: input.targetItemVariantIds }
            : {}),
          ...(input.force !== undefined ? { force: input.force } : {}),
        });

      if (batches.length === 0) {
        await this.cancelSync(source, jobRunId, {
          reason: 'no_overlap_candidates',
        });

        return;
      }

      await this.sourceOperationsService.upsertSyncStatus({
        source,
        syncType: SyncType.LISTINGS,
        status: SyncStatus.RUNNING,
        jobRunId,
        details: {
          batchCount: batches.length,
          targetCount: batches.reduce(
            (total, batch) => total + batch.targets.length,
            0,
          ),
          classification: definition.classification,
        } satisfies Prisma.InputJsonValue,
      });

      let successCount = 0;
      let failureCount = 0;
      let rateLimited = false;
      let totalLatencyMs = 0;
      const queuedArchiveJobs: string[] = [];

      for (const batch of batches) {
        const reservation = await this.runtimeService.reserve(source, 1);

        if (!reservation.granted) {
          rateLimited = true;
          break;
        }

        const startedAt = Date.now();

        try {
          const rawPayload = await this.executeWithRetries(
            definition.retryAttempts,
            definition.retryBaseDelayMs,
            () =>
              this.managedMarketHttpClientService.fetchListingsSnapshot({
                source,
                targets: batch.targets,
              }),
          );
          const enqueueResult =
            await this.sourceIngestionService.enqueueRawPayload({
              source,
              endpointName: definition.endpointName,
              observedAt: new Date(),
              payload: {
                source,
                batchId: batch.batchId,
                targetCount: batch.targets.length,
                classification: definition.classification,
                targets: batch.targets,
                payload: rawPayload,
              },
              jobRunId,
            });

          totalLatencyMs += Date.now() - startedAt;
          successCount += 1;
          if (enqueueResult.jobId) {
            queuedArchiveJobs.push(String(enqueueResult.jobId));
          }
          await this.runtimeService.recordSuccess(source);
        } catch (error) {
          failureCount += 1;
          totalLatencyMs += Date.now() - startedAt;
          await this.runtimeService.recordFailure(source);

          if (
            error instanceof ManagedMarketHttpError &&
            error.statusCode === 429
          ) {
            rateLimited = true;
            await this.runtimeService.markRateLimited(source);
            break;
          }
        }
      }

      const result = {
        batchCount: batches.length,
        successCount,
        failureCount,
        rateLimited,
        queuedArchiveJobs,
        overlapTargetCount: batches.reduce(
          (total, batch) => total + batch.targets.length,
          0,
        ),
      } satisfies Prisma.InputJsonValue;

      if (successCount > 0) {
        await this.sourceOperationsService.completeJobRun({
          jobRunId,
          result,
        });
        await this.sourceOperationsService.upsertSyncStatus({
          source,
          syncType: SyncType.LISTINGS,
          status:
            failureCount > 0 || rateLimited
              ? SyncStatus.DEGRADED
              : SyncStatus.SUCCEEDED,
          jobRunId,
          markSuccessful: true,
          details: result,
        });
        await this.sourceOperationsService.recordHealthMetric({
          source,
          status:
            failureCount > 0 || rateLimited
              ? HealthStatus.DEGRADED
              : HealthStatus.OK,
          availabilityRatio:
            successCount / Math.max(1, successCount + failureCount),
          errorRate: failureCount / Math.max(1, successCount + failureCount),
          latencyMs: Math.round(
            totalLatencyMs / Math.max(1, successCount + failureCount),
          ),
          ...(rateLimited ? { rateLimitRemaining: 0 } : {}),
          details: result,
        });

        return;
      }

      await this.sourceOperationsService.failJobRun({
        jobRunId,
        errorMessage: `${definition.displayName} sync completed without a successful raw archive enqueue.`,
        result,
      });
      await this.sourceOperationsService.upsertSyncStatus({
        source,
        syncType: SyncType.LISTINGS,
        status: SyncStatus.FAILED,
        jobRunId,
        markFailed: true,
        details: result,
      });
      await this.sourceOperationsService.recordHealthMetric({
        source,
        status: HealthStatus.FAILED,
        availabilityRatio: 0,
        errorRate: 1,
        details: result,
      });
    } catch (error) {
      const failureDetails = {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown managed source error',
      } satisfies Prisma.InputJsonValue;

      await this.runtimeService.recordFailure(source);
      await this.sourceOperationsService.failJobRun({
        jobRunId,
        errorMessage:
          error instanceof Error
            ? error.message
            : 'Unknown managed source error',
        result: failureDetails,
      });
      await this.sourceOperationsService.upsertSyncStatus({
        source,
        syncType: SyncType.LISTINGS,
        status: SyncStatus.FAILED,
        jobRunId,
        markFailed: true,
        details: failureDetails,
      });
      await this.sourceOperationsService.recordHealthMetric({
        source,
        status: HealthStatus.FAILED,
        availabilityRatio: 0,
        errorRate: 1,
        details: failureDetails,
      });
      throw error;
    }
  }

  private async cancelSync(
    source: ManagedMarketSourceKey,
    jobRunId: string,
    details: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.sourceOperationsService.cancelJobRun({
      jobRunId,
      result: details,
    });
    await this.sourceOperationsService.upsertSyncStatus({
      source,
      syncType: SyncType.LISTINGS,
      status: SyncStatus.IDLE,
      jobRunId,
      details,
    });
  }

  private async executeWithRetries<T>(
    attempts: number,
    baseDelayMs: number,
    operation: () => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= Math.max(1, attempts); attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        if (attempt >= attempts) {
          break;
        }

        const jitterMs = Math.floor(Math.random() * 250);
        await this.sleep(baseDelayMs * attempt + jitterMs);
      }
    }

    throw lastError;
  }

  private resolveStaleAfterMs(source: ManagedMarketSourceKey): number {
    switch (source) {
      case 'bitskins':
        return 15 * 60 * 1000;
      case 'youpin':
        return 18 * 60 * 1000;
      case 'c5game':
        return 25 * 60 * 1000;
      case 'csmoney':
        return 30 * 60 * 1000;
    }
  }

  private serializeJson(value: unknown): Prisma.InputJsonValue | null {
    if (value === undefined) {
      return null;
    }

    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private sleep(durationMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, durationMs));
  }
}
