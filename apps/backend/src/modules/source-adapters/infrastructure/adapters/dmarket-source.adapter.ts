import { SyncStatus, SyncType, type Prisma } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../../infrastructure/config/app-config.service';
import type { SourceSyncContext } from '../../domain/source-adapter.interface';
import {
  DMARKET_SYNC_MARKET_JOB_NAME,
  DMARKET_SYNC_MARKET_QUEUE,
} from '../../domain/dmarket.constants';
import type { SourceAdapterDescriptor } from '../../domain/source-adapter.interface';
import type { SourceJobQueue } from '../../domain/source-job-queue.port';
import {
  createEmptySourceSyncResult,
  type SourceSyncResultDto,
} from '../../dto/source-sync-result.dto';
import type { DMarketSyncJobData } from '../../dto/dmarket-sync.job.dto';
import { SourceOperationsService } from '../../services/source-operations.service';
import { DMarketRateLimitService } from '../../services/dmarket-rate-limit.service';
import { BaseSourceAdapter } from './base-source.adapter';

@Injectable()
export class DMarketSourceAdapter extends BaseSourceAdapter {
  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
    @Inject(DMARKET_SYNC_MARKET_QUEUE)
    private readonly dmarketSyncMarketQueue: SourceJobQueue<DMarketSyncJobData>,
    @Inject(SourceOperationsService)
    private readonly sourceOperationsService: SourceOperationsService,
    @Inject(DMarketRateLimitService)
    private readonly dmarketRateLimitService: DMarketRateLimitService,
  ) {
    super();
  }

  override get descriptor(): SourceAdapterDescriptor {
    return {
      key: 'dmarket',
      displayName: 'DMarket',
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
        weight: 89,
        enabled: this.configService.isDMarketEnabled(),
        fallback: {
          fallbackSources: ['skinport', 'csfloat', 'steam-snapshot'],
          activateAfterConsecutiveFailures: 3,
          cooldownSeconds: 180,
        },
      },
    };
  }

  override getHealth() {
    return this.sourceOperationsService.getSourceHealth('dmarket');
  }

  override getRateLimitState() {
    return this.dmarketRateLimitService.getState();
  }

  override async sync(
    context: SourceSyncContext,
  ): Promise<SourceSyncResultDto> {
    if (!this.configService.isDMarketEnabled()) {
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
          'DMarket sync is disabled until ENABLE_DMARKET, DMARKET_PUBLIC_KEY, and DMARKET_SECRET_KEY are configured.',
        ],
      });
    }

    const externalJobId = `dmarket:sync:${context.requestedAt.getTime()}`;
    const syncJobData: DMarketSyncJobData = {
      trigger: context.trigger,
      mode: context.mode,
      requestedAt: context.requestedAt.toISOString(),
      externalJobId,
    };

    await this.dmarketSyncMarketQueue.add(DMARKET_SYNC_MARKET_JOB_NAME, syncJobData, {
      jobId: externalJobId,
    });
    const jobRunId = await this.sourceOperationsService.ensureQueuedJobRun({
      source: 'dmarket',
      queueName: DMARKET_SYNC_MARKET_JOB_NAME,
      jobName: DMARKET_SYNC_MARKET_JOB_NAME,
      externalJobId,
      payload: JSON.parse(JSON.stringify(syncJobData)) as Prisma.InputJsonValue,
    });
    await this.sourceOperationsService.upsertSyncStatus({
      source: 'dmarket',
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
          queueName: DMARKET_SYNC_MARKET_JOB_NAME,
          jobName: DMARKET_SYNC_MARKET_JOB_NAME,
          externalJobId,
          jobRunId,
        },
      ],
      warnings: [
        'DMarket sync is queued asynchronously and ingests bounded title-targeted snapshots only.',
      ],
    });
  }
}
