import { SyncStatus, SyncType, type Prisma } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { SourceOperationsService } from '../../services/source-operations.service';
import { ManagedMarketSourceDefinitionsService } from '../../services/managed-market-source-definitions.service';
import { ManagedMarketSourceRuntimeService } from '../../services/managed-market-source-runtime.service';
import {
  YOUPIN_SYNC_JOB_NAME,
  YOUPIN_SYNC_QUEUE,
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
export class YouPinSourceAdapter extends BaseSourceAdapter {
  constructor(
    @Inject(YOUPIN_SYNC_QUEUE)
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
    const definition = this.definitionsService.get('youpin');

    return {
      key: 'youpin',
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
        tier:
          definition.classification === 'REFERENCE' ? 'backup' : 'secondary',
        weight: definition.classification === 'REFERENCE' ? 62 : 84,
        enabled: definition.enabled,
        fallback: {
          fallbackSources: ['skinport', 'csfloat', 'steam-snapshot'],
          activateAfterConsecutiveFailures: 3,
          cooldownSeconds: definition.circuitBreakerCooldownSeconds,
        },
      },
    };
  }

  override getHealth() {
    return this.sourceOperationsService.getSourceHealth('youpin');
  }

  override getRateLimitState() {
    return this.runtimeService.getRateLimitState('youpin');
  }

  override async sync(
    context: SourceSyncContext,
  ): Promise<SourceSyncResultDto> {
    const definition = this.definitionsService.get('youpin');

    if (!definition.enabled) {
      const [health, rateLimitState] = await Promise.all([
        this.getHealth(),
        this.getRateLimitState(),
      ]);

      return createEmptySourceSyncResult({
        source: 'youpin',
        trigger: context.trigger,
        mode: context.mode,
        startedAt: context.requestedAt,
        completedAt: new Date(),
        health,
        rateLimitState,
        warnings: ['YouPin sync is disabled by config.'],
      });
    }

    const externalJobId = `youpin:sync:${context.requestedAt.getTime()}`;
    const syncJobData: ManagedMarketSyncJobData = {
      trigger: context.trigger,
      mode: context.mode,
      requestedAt: context.requestedAt.toISOString(),
      externalJobId,
    };

    await this.syncQueue.add(YOUPIN_SYNC_JOB_NAME, syncJobData, {
      jobId: externalJobId,
    });
    const jobRunId = await this.sourceOperationsService.ensureQueuedJobRun({
      source: 'youpin',
      queueName: YOUPIN_SYNC_JOB_NAME,
      jobName: YOUPIN_SYNC_JOB_NAME,
      externalJobId,
      payload: JSON.parse(JSON.stringify(syncJobData)) as Prisma.InputJsonValue,
    });
    await this.sourceOperationsService.upsertSyncStatus({
      source: 'youpin',
      syncType: SyncType.LISTINGS,
      status: SyncStatus.RUNNING,
      jobRunId,
      details: {
        phase: 'queued',
        trigger: context.trigger,
        mode: context.mode,
        externalJobId,
        classification: definition.classification,
      } satisfies Prisma.InputJsonValue,
    });

    const [health, rateLimitState] = await Promise.all([
      this.getHealth(),
      this.getRateLimitState(),
    ]);

    return createEmptySourceSyncResult({
      source: 'youpin',
      trigger: context.trigger,
      mode: context.mode,
      startedAt: context.requestedAt,
      completedAt: new Date(),
      health,
      rateLimitState,
      acceptedJobs: [
        {
          syncType: SyncType.LISTINGS,
          queueName: YOUPIN_SYNC_JOB_NAME,
          jobName: YOUPIN_SYNC_JOB_NAME,
          externalJobId,
          jobRunId,
        },
      ],
      warnings: [
        definition.classification === 'REFERENCE'
          ? 'YouPin is running in reference-only mode and will improve confirmation rather than primary pair building.'
          : 'YouPin is queued as a direct source and will archive raw payloads before normalization.',
      ],
    });
  }
}
