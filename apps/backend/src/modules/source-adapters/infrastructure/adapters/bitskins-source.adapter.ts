import { SyncStatus, SyncType, type Prisma } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../../infrastructure/config/app-config.service';
import type {
  SourceAdapterDescriptor,
  SourceSyncContext,
} from '../../domain/source-adapter.interface';
import type { SourceJobQueue } from '../../domain/source-job-queue.port';
import {
  BITSKINS_SYNC_JOB_NAME,
  BITSKINS_SYNC_QUEUE,
} from '../../domain/managed-market.constants';
import type { ManagedMarketSyncJobData } from '../../domain/managed-market-source.types';
import {
  createEmptySourceSyncResult,
  type SourceSyncResultDto,
} from '../../dto/source-sync-result.dto';
import { ManagedMarketSourceRuntimeService } from '../../services/managed-market-source-runtime.service';
import { SourceOperationsService } from '../../services/source-operations.service';
import { BaseSourceAdapter } from './base-source.adapter';

@Injectable()
export class BitSkinsSourceAdapter extends BaseSourceAdapter {
  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
    @Inject(BITSKINS_SYNC_QUEUE)
    private readonly bitSkinsSyncQueue: SourceJobQueue<ManagedMarketSyncJobData>,
    @Inject(SourceOperationsService)
    private readonly sourceOperationsService: SourceOperationsService,
    @Inject(ManagedMarketSourceRuntimeService)
    private readonly runtimeService: ManagedMarketSourceRuntimeService,
  ) {
    super();
  }

  override get descriptor(): SourceAdapterDescriptor {
    return {
      key: 'bitskins',
      displayName: 'BitSkins',
      category: 'marketplace',
      classification: 'PRIMARY',
      behavior: {
        canDrivePrimaryTruth: true,
        canProvideFallbackPricing: true,
        canProvideQuantitySignals: true,
        canBeUsedForPairBuilding: true,
        canBeUsedForConfirmationOnly: true,
      },
      capabilities: {
        supportedSyncModes: ['full-snapshot', 'market-state-only'],
        supportsRawListingSnapshots: true,
        supportsNormalizedListings: true,
        supportsNormalizedMarketState: true,
        supportsIncrementalSync: false,
        supportsFloatMetadata: false,
        supportsPatternMetadata: false,
        supportsPhaseMetadata: true,
        supportsVariantSignals: true,
        supportsRateLimitTelemetry: true,
        supportsHealthChecks: true,
        supportsFallbackRole: true,
      },
      priority: {
        tier: 'secondary',
        weight: 88,
        enabled: this.configService.isBitSkinsEnabled(),
        fallback: {
          fallbackSources: ['skinport', 'csfloat', 'steam-snapshot'],
          activateAfterConsecutiveFailures: 3,
          cooldownSeconds: 180,
        },
      },
    };
  }

  override getHealth() {
    return this.sourceOperationsService.getSourceHealth('bitskins');
  }

  override getRateLimitState() {
    return this.runtimeService.getRateLimitState('bitskins');
  }

  override async sync(
    context: SourceSyncContext,
  ): Promise<SourceSyncResultDto> {
    if (!this.configService.isBitSkinsEnabled()) {
      const [health, rateLimitState] = await Promise.all([
        this.getHealth(),
        this.getRateLimitState(),
      ]);

      return createEmptySourceSyncResult({
        source: this.descriptor.key,
        trigger: context.trigger,
        mode: context.mode,
        startedAt: context.requestedAt,
        completedAt: new Date(),
        health,
        rateLimitState,
        warnings: [
          'BitSkins sync is disabled until ENABLE_BITSKINS and BITSKINS_API_KEY are configured.',
        ],
      });
    }

    const externalJobId = `bitskins:sync:${context.requestedAt.getTime()}`;
    const syncJobData: ManagedMarketSyncJobData = {
      trigger: context.trigger,
      mode: context.mode,
      requestedAt: context.requestedAt.toISOString(),
      externalJobId,
    };

    await this.bitSkinsSyncQueue.add(BITSKINS_SYNC_JOB_NAME, syncJobData, {
      jobId: externalJobId,
    });
    const jobRunId = await this.sourceOperationsService.ensureQueuedJobRun({
      source: 'bitskins',
      queueName: BITSKINS_SYNC_JOB_NAME,
      jobName: BITSKINS_SYNC_JOB_NAME,
      externalJobId,
      payload: JSON.parse(JSON.stringify(syncJobData)) as Prisma.InputJsonValue,
    });
    await this.sourceOperationsService.upsertSyncStatus({
      source: 'bitskins',
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
      source: this.descriptor.key,
      trigger: context.trigger,
      mode: context.mode,
      startedAt: context.requestedAt,
      completedAt: new Date(),
      health,
      rateLimitState,
      acceptedJobs: [
        {
          syncType: SyncType.LISTINGS,
          queueName: BITSKINS_SYNC_JOB_NAME,
          jobName: BITSKINS_SYNC_JOB_NAME,
          externalJobId,
          jobRunId,
        },
      ],
      warnings: [
        'BitSkins sync is queued asynchronously and filters the full aggregate snapshot down to bounded overlap targets before persistence.',
      ],
    });
  }
}
