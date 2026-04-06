import { SyncStatus, SyncType, type Prisma } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../../infrastructure/config/app-config.service';
import type { SourceSyncContext } from '../../domain/source-adapter.interface';
import {
  SKINPORT_SYNC_ITEMS_JOB_NAME,
  SKINPORT_SYNC_ITEMS_QUEUE,
  SKINPORT_SYNC_SALES_HISTORY_JOB_NAME,
  SKINPORT_SYNC_SALES_HISTORY_QUEUE,
} from '../../domain/skinport.constants';
import type { SourceJobQueue } from '../../domain/source-job-queue.port';
import type { SourceRateLimitStateModel } from '../../domain/source-rate-limit-state.model';
import {
  createEmptySourceSyncResult,
  type SourceAcceptedJobRefDto,
  type SourceSyncResultDto,
} from '../../dto/source-sync-result.dto';
import type { SkinportSyncJobData } from '../../dto/skinport-sync.job.dto';
import { SourceOperationsService } from '../../services/source-operations.service';
import { SkinportRateLimitService } from '../../services/skinport-rate-limit.service';
import type { SourceAdapterDescriptor } from '../../domain/source-adapter.interface';
import { BaseSourceAdapter } from './base-source.adapter';

@Injectable()
export class SkinportSourceAdapter extends BaseSourceAdapter {
  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
    @Inject(SKINPORT_SYNC_ITEMS_QUEUE)
    private readonly skinportSyncItemsQueue: SourceJobQueue<SkinportSyncJobData>,
    @Inject(SKINPORT_SYNC_SALES_HISTORY_QUEUE)
    private readonly skinportSyncSalesHistoryQueue: SourceJobQueue<SkinportSyncJobData>,
    @Inject(SourceOperationsService)
    private readonly sourceOperationsService: SourceOperationsService,
    @Inject(SkinportRateLimitService)
    private readonly skinportRateLimitService: SkinportRateLimitService,
  ) {
    super();
  }

  override readonly descriptor = {
    key: 'skinport',
    displayName: 'Skinport',
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
      tier: 'primary',
      weight: 100,
      enabled: true,
      fallback: {
        fallbackSources: ['csfloat', 'steam-snapshot', 'backup-aggregator'],
        activateAfterConsecutiveFailures: 2,
        cooldownSeconds: 300,
      },
    },
  } as const satisfies SourceAdapterDescriptor;

  override getHealth() {
    return this.sourceOperationsService.getSourceHealth('skinport');
  }

  override getRateLimitState(): Promise<SourceRateLimitStateModel> {
    return this.skinportRateLimitService.getState();
  }

  override async sync(
    context: SourceSyncContext,
  ): Promise<SourceSyncResultDto> {
    const warnings: string[] = [
      'Skinport sync enqueues cached snapshot jobs; opportunity scans should read stored market state only.',
    ];
    const acceptedJobs: SourceAcceptedJobRefDto[] = [];
    const cacheWindowBucket = Math.floor(
      context.requestedAt.getTime() /
        Math.max(this.configService.skinportCacheTtlMs, 1_000),
    );

    if (this.configService.skinportItemsSyncEnabled) {
      const externalJobId = `skinport:items:${cacheWindowBucket}`;
      const syncJobData: SkinportSyncJobData = {
        trigger: context.trigger,
        mode: context.mode,
        requestedAt: context.requestedAt.toISOString(),
        externalJobId,
      };

      await this.skinportSyncItemsQueue.add(
        SKINPORT_SYNC_ITEMS_JOB_NAME,
        syncJobData,
        {
          // De-duplicate snapshot pulls within the cached endpoint window.
          jobId: externalJobId,
        },
      );
      const jobRunId = await this.sourceOperationsService.ensureQueuedJobRun({
        source: 'skinport',
        queueName: SKINPORT_SYNC_ITEMS_JOB_NAME,
        jobName: SKINPORT_SYNC_ITEMS_JOB_NAME,
        externalJobId,
        payload: this.serializeJson(syncJobData),
      });
      await this.sourceOperationsService.upsertSyncStatus({
        source: 'skinport',
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
      acceptedJobs.push({
        syncType: SyncType.LISTINGS,
        queueName: SKINPORT_SYNC_ITEMS_JOB_NAME,
        jobName: SKINPORT_SYNC_ITEMS_JOB_NAME,
        externalJobId,
        jobRunId,
      });
    } else {
      warnings.push(
        'Skinport items snapshot sync is disabled by configuration.',
      );
    }

    if (this.configService.skinportSalesHistorySyncEnabled) {
      const externalJobId = `skinport:sales-history:${cacheWindowBucket}`;
      const syncJobData: SkinportSyncJobData = {
        trigger: context.trigger,
        mode: context.mode,
        requestedAt: context.requestedAt.toISOString(),
        externalJobId,
      };

      await this.skinportSyncSalesHistoryQueue.add(
        SKINPORT_SYNC_SALES_HISTORY_JOB_NAME,
        syncJobData,
        {
          // De-duplicate snapshot pulls within the cached endpoint window.
          jobId: externalJobId,
        },
      );
      const jobRunId = await this.sourceOperationsService.ensureQueuedJobRun({
        source: 'skinport',
        queueName: SKINPORT_SYNC_SALES_HISTORY_JOB_NAME,
        jobName: SKINPORT_SYNC_SALES_HISTORY_JOB_NAME,
        externalJobId,
        payload: this.serializeJson(syncJobData),
      });
      await this.sourceOperationsService.upsertSyncStatus({
        source: 'skinport',
        syncType: SyncType.MARKET_STATE,
        status: SyncStatus.RUNNING,
        jobRunId,
        details: {
          phase: 'queued',
          trigger: context.trigger,
          mode: context.mode,
          externalJobId,
        } satisfies Prisma.InputJsonValue,
      });
      acceptedJobs.push({
        syncType: SyncType.MARKET_STATE,
        queueName: SKINPORT_SYNC_SALES_HISTORY_JOB_NAME,
        jobName: SKINPORT_SYNC_SALES_HISTORY_JOB_NAME,
        externalJobId,
        jobRunId,
      });
    } else {
      warnings.push(
        'Skinport sales history sync is disabled by configuration.',
      );
    }

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
      acceptedJobs,
      warnings,
    });
  }

  private serializeJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
