import { SyncStatus, SyncType, type Prisma } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { SourceOperationsService } from '../../services/source-operations.service';
import { ManagedMarketSourceDefinitionsService } from '../../services/managed-market-source-definitions.service';
import { ManagedMarketSourceRuntimeService } from '../../services/managed-market-source-runtime.service';
import {
  CSMONEY_SYNC_JOB_NAME,
  CSMONEY_SYNC_QUEUE,
} from '../../domain/managed-market.constants';
import type {
  SourceAdapterDescriptor,
  SourceSyncContext,
} from '../../domain/source-adapter.interface';
import type { SourceJobQueue } from '../../domain/source-job-queue.port';
import type { ManagedMarketSyncJobData } from '../../domain/managed-market-source.types';
import {
  createEmptySourceSyncResult,
  type SourceSyncResultDto,
} from '../../dto/source-sync-result.dto';
import { BaseSourceAdapter } from './base-source.adapter';

@Injectable()
export class CSMoneySourceAdapter extends BaseSourceAdapter {
  constructor(
    @Inject(CSMONEY_SYNC_QUEUE)
    private readonly syncQueue: SourceJobQueue<ManagedMarketSyncJobData>,
    @Inject(SourceOperationsService)
    private readonly sourceOperationsService: SourceOperationsService,
    @Inject(ManagedMarketSourceRuntimeService)
    private readonly runtimeService: ManagedMarketSourceRuntimeService,
    @Inject(ManagedMarketSourceDefinitionsService)
    private readonly definitionsService: ManagedMarketSourceDefinitionsService,
  ) {
    super();
  }

  override get descriptor(): SourceAdapterDescriptor {
    const definition = this.definitionsService.get('csmoney');

    return {
      key: 'csmoney',
      displayName: definition.displayName,
      category: 'marketplace',
      classification: definition.classification,
      behavior: definition.behavior,
      capabilities: {
        supportedSyncModes: ['full-snapshot', 'market-state-only'],
        supportsRawListingSnapshots: true,
        supportsNormalizedListings: true,
        supportsNormalizedMarketState: true,
        supportsIncrementalSync: false,
        supportsFloatMetadata: true,
        supportsPatternMetadata: true,
        supportsPhaseMetadata: true,
        supportsVariantSignals: true,
        supportsRateLimitTelemetry: true,
        supportsHealthChecks: true,
        supportsFallbackRole: true,
      },
      priority: {
        tier: 'secondary',
        weight: 58,
        enabled: definition.enabled,
        fallback: {
          fallbackSources: [
            'skinport',
            'csfloat',
            'steam-snapshot',
            'backup-aggregator',
          ],
          activateAfterConsecutiveFailures: 2,
          cooldownSeconds: definition.circuitBreakerCooldownSeconds,
        },
      },
    };
  }

  override getHealth() {
    return this.sourceOperationsService.getSourceHealth('csmoney');
  }

  override getRateLimitState() {
    return this.runtimeService.getRateLimitState('csmoney');
  }

  override async sync(
    context: SourceSyncContext,
  ): Promise<SourceSyncResultDto> {
    const definition = this.definitionsService.get('csmoney');

    if (!definition.enabled) {
      const [health, rateLimitState] = await Promise.all([
        this.getHealth(),
        this.getRateLimitState(),
      ]);

      return createEmptySourceSyncResult({
        source: 'csmoney',
        trigger: context.trigger,
        mode: context.mode,
        startedAt: context.requestedAt,
        completedAt: new Date(),
        health,
        rateLimitState,
        warnings: ['CS.MONEY sync is disabled by feature flag.'],
      });
    }

    const externalJobId = `csmoney:sync:${context.requestedAt.getTime()}`;
    const syncJobData: ManagedMarketSyncJobData = {
      trigger: context.trigger,
      mode: context.mode,
      requestedAt: context.requestedAt.toISOString(),
      externalJobId,
    };

    await this.syncQueue.add(CSMONEY_SYNC_JOB_NAME, syncJobData, {
      jobId: externalJobId,
    });
    const jobRunId = await this.sourceOperationsService.ensureQueuedJobRun({
      source: 'csmoney',
      queueName: CSMONEY_SYNC_JOB_NAME,
      jobName: CSMONEY_SYNC_JOB_NAME,
      externalJobId,
      payload: JSON.parse(JSON.stringify(syncJobData)) as Prisma.InputJsonValue,
    });
    await this.sourceOperationsService.upsertSyncStatus({
      source: 'csmoney',
      syncType: SyncType.LISTINGS,
      status: SyncStatus.RUNNING,
      jobRunId,
      details: {
        phase: 'queued',
        trigger: context.trigger,
        mode: context.mode,
        externalJobId,
        fragile: true,
      } satisfies Prisma.InputJsonValue,
    });

    const [health, rateLimitState] = await Promise.all([
      this.getHealth(),
      this.getRateLimitState(),
    ]);

    return createEmptySourceSyncResult({
      source: 'csmoney',
      trigger: context.trigger,
      mode: context.mode,
      startedAt: context.requestedAt,
      completedAt: new Date(),
      health,
      rateLimitState,
      acceptedJobs: [
        {
          syncType: SyncType.LISTINGS,
          queueName: CSMONEY_SYNC_JOB_NAME,
          jobName: CSMONEY_SYNC_JOB_NAME,
          externalJobId,
          jobRunId,
        },
      ],
      warnings: [
        'CS.MONEY is treated as a fragile source; failures open a circuit breaker and reduce confidence rather than breaking the scanner.',
      ],
    });
  }
}
