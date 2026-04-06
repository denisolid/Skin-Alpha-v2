import { SyncStatus, SyncType, type Prisma } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { SourceOperationsService } from '../../services/source-operations.service';
import { ManagedMarketSourceDefinitionsService } from '../../services/managed-market-source-definitions.service';
import { ManagedMarketSourceRuntimeService } from '../../services/managed-market-source-runtime.service';
import {
  C5GAME_SYNC_JOB_NAME,
  C5GAME_SYNC_QUEUE,
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
export class C5GameSourceAdapter extends BaseSourceAdapter {
  constructor(
    @Inject(C5GAME_SYNC_QUEUE)
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
    const definition = this.definitionsService.get('c5game');

    return {
      key: 'c5game',
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
        weight: 72,
        enabled: definition.enabled,
        fallback: {
          fallbackSources: ['skinport', 'csfloat', 'steam-snapshot'],
          activateAfterConsecutiveFailures: 2,
          cooldownSeconds: definition.circuitBreakerCooldownSeconds,
        },
      },
    };
  }

  override getHealth() {
    return this.sourceOperationsService.getSourceHealth('c5game');
  }

  override getRateLimitState() {
    return this.runtimeService.getRateLimitState('c5game');
  }

  override async sync(
    context: SourceSyncContext,
  ): Promise<SourceSyncResultDto> {
    const definition = this.definitionsService.get('c5game');

    if (!definition.enabled) {
      const [health, rateLimitState] = await Promise.all([
        this.getHealth(),
        this.getRateLimitState(),
      ]);

      return createEmptySourceSyncResult({
        source: 'c5game',
        trigger: context.trigger,
        mode: context.mode,
        startedAt: context.requestedAt,
        completedAt: new Date(),
        health,
        rateLimitState,
        warnings: ['C5Game sync is disabled by feature flag.'],
      });
    }

    const externalJobId = `c5game:sync:${context.requestedAt.getTime()}`;
    const syncJobData: ManagedMarketSyncJobData = {
      trigger: context.trigger,
      mode: context.mode,
      requestedAt: context.requestedAt.toISOString(),
      externalJobId,
    };

    await this.syncQueue.add(C5GAME_SYNC_JOB_NAME, syncJobData, {
      jobId: externalJobId,
    });
    const jobRunId = await this.sourceOperationsService.ensureQueuedJobRun({
      source: 'c5game',
      queueName: C5GAME_SYNC_JOB_NAME,
      jobName: C5GAME_SYNC_JOB_NAME,
      externalJobId,
      payload: JSON.parse(JSON.stringify(syncJobData)) as Prisma.InputJsonValue,
    });
    await this.sourceOperationsService.upsertSyncStatus({
      source: 'c5game',
      syncType: SyncType.LISTINGS,
      status: SyncStatus.RUNNING,
      jobRunId,
      details: {
        phase: 'queued',
        trigger: context.trigger,
        mode: context.mode,
        externalJobId,
      } satisfies Prisma.InputJsonValue,
    });

    const [health, rateLimitState] = await Promise.all([
      this.getHealth(),
      this.getRateLimitState(),
    ]);

    return createEmptySourceSyncResult({
      source: 'c5game',
      trigger: context.trigger,
      mode: context.mode,
      startedAt: context.requestedAt,
      completedAt: new Date(),
      health,
      rateLimitState,
      acceptedJobs: [
        {
          syncType: SyncType.LISTINGS,
          queueName: C5GAME_SYNC_JOB_NAME,
          jobName: C5GAME_SYNC_JOB_NAME,
          externalJobId,
          jobRunId,
        },
      ],
      warnings: [
        'C5Game is an optional direct source behind a feature flag and will not block feed calculations.',
      ],
    });
  }
}
