import { SyncStatus, SyncType, type Prisma } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../../infrastructure/config/app-config.service';
import type { SourceSyncContext } from '../../domain/source-adapter.interface';
import {
  WAXPEER_SYNC_MARKET_JOB_NAME,
  WAXPEER_SYNC_MARKET_QUEUE,
} from '../../domain/waxpeer.constants';
import type { SourceAdapterDescriptor } from '../../domain/source-adapter.interface';
import type { SourceJobQueue } from '../../domain/source-job-queue.port';
import {
  createEmptySourceSyncResult,
  type SourceSyncResultDto,
} from '../../dto/source-sync-result.dto';
import type { WaxpeerSyncJobData } from '../../dto/waxpeer-sync.job.dto';
import { SourceOperationsService } from '../../services/source-operations.service';
import { WaxpeerRateLimitService } from '../../services/waxpeer-rate-limit.service';
import { BaseSourceAdapter } from './base-source.adapter';

@Injectable()
export class WaxpeerSourceAdapter extends BaseSourceAdapter {
  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
    @Inject(WAXPEER_SYNC_MARKET_QUEUE)
    private readonly waxpeerSyncMarketQueue: SourceJobQueue<WaxpeerSyncJobData>,
    @Inject(SourceOperationsService)
    private readonly sourceOperationsService: SourceOperationsService,
    @Inject(WaxpeerRateLimitService)
    private readonly waxpeerRateLimitService: WaxpeerRateLimitService,
  ) {
    super();
  }

  override get descriptor(): SourceAdapterDescriptor {
    return {
      key: 'waxpeer',
      displayName: 'Waxpeer',
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
        supportedSyncModes: ['incremental', 'market-state-only'],
        supportsRawListingSnapshots: true,
        supportsNormalizedListings: true,
        supportsNormalizedMarketState: true,
        supportsIncrementalSync: true,
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
        weight: 87,
        enabled: this.configService.isWaxpeerEnabled(),
        fallback: {
          fallbackSources: ['skinport', 'csfloat', 'steam-snapshot'],
          activateAfterConsecutiveFailures: 3,
          cooldownSeconds: 180,
        },
      },
    };
  }

  override getHealth() {
    return this.sourceOperationsService.getSourceHealth('waxpeer');
  }

  override getRateLimitState() {
    return this.waxpeerRateLimitService.getState();
  }

  override async sync(
    context: SourceSyncContext,
  ): Promise<SourceSyncResultDto> {
    if (!this.configService.isWaxpeerEnabled()) {
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
          'Waxpeer sync is disabled until ENABLE_WAXPEER and WAXPEER_API_KEY are configured.',
        ],
      });
    }

    const externalJobId = `waxpeer:sync:${context.requestedAt.getTime()}`;
    const syncJobData: WaxpeerSyncJobData = {
      trigger: context.trigger,
      mode: context.mode,
      requestedAt: context.requestedAt.toISOString(),
      externalJobId,
    };

    await this.waxpeerSyncMarketQueue.add(WAXPEER_SYNC_MARKET_JOB_NAME, syncJobData, {
      jobId: externalJobId,
    });
    const jobRunId = await this.sourceOperationsService.ensureQueuedJobRun({
      source: 'waxpeer',
      queueName: WAXPEER_SYNC_MARKET_JOB_NAME,
      jobName: WAXPEER_SYNC_MARKET_JOB_NAME,
      externalJobId,
      payload: JSON.parse(JSON.stringify(syncJobData)) as Prisma.InputJsonValue,
    });
    await this.sourceOperationsService.upsertSyncStatus({
      source: 'waxpeer',
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
          queueName: WAXPEER_SYNC_MARKET_JOB_NAME,
          jobName: WAXPEER_SYNC_MARKET_JOB_NAME,
          externalJobId,
          jobRunId,
        },
      ],
      warnings: [
        'Waxpeer sync is queued asynchronously and ingests bounded multi-name market batches only.',
      ],
    });
  }
}
