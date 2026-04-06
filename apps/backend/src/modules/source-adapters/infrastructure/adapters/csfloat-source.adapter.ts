import { SyncStatus, SyncType, type Prisma } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../../infrastructure/config/app-config.service';
import type { SourceSyncContext } from '../../domain/source-adapter.interface';
import {
  CSFLOAT_SYNC_LISTINGS_JOB_NAME,
  CSFLOAT_SYNC_LISTINGS_QUEUE,
} from '../../domain/csfloat.constants';
import type { SourceAdapterDescriptor } from '../../domain/source-adapter.interface';
import type { SourceJobQueue } from '../../domain/source-job-queue.port';
import type { SourceRateLimitStateModel } from '../../domain/source-rate-limit-state.model';
import {
  createEmptySourceSyncResult,
  type SourceSyncResultDto,
} from '../../dto/source-sync-result.dto';
import type { CsFloatSyncJobData } from '../../dto/csfloat-sync.job.dto';
import { SourceOperationsService } from '../../services/source-operations.service';
import { CsFloatRateLimitService } from '../../services/csfloat-rate-limit.service';
import { BaseSourceAdapter } from './base-source.adapter';

@Injectable()
export class CsFloatSourceAdapter extends BaseSourceAdapter {
  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
    @Inject(CSFLOAT_SYNC_LISTINGS_QUEUE)
    private readonly csfloatSyncListingsQueue: SourceJobQueue<CsFloatSyncJobData>,
    @Inject(SourceOperationsService)
    private readonly sourceOperationsService: SourceOperationsService,
    @Inject(CsFloatRateLimitService)
    private readonly csfloatRateLimitService: CsFloatRateLimitService,
  ) {
    super();
  }

  override readonly descriptor = {
    key: 'csfloat',
    displayName: 'CSFloat',
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
      supportedSyncModes: ['full-snapshot', 'incremental', 'market-state-only'],
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
      weight: 90,
      enabled: true,
      fallback: {
        fallbackSources: ['skinport', 'steam-snapshot', 'backup-aggregator'],
        activateAfterConsecutiveFailures: 2,
        cooldownSeconds: 120,
      },
    },
  } as const satisfies SourceAdapterDescriptor;

  override getHealth() {
    return this.sourceOperationsService.getSourceHealth('csfloat');
  }

  override getRateLimitState(): Promise<SourceRateLimitStateModel> {
    return this.csfloatRateLimitService.getState();
  }

  override async sync(
    context: SourceSyncContext,
  ): Promise<SourceSyncResultDto> {
    if (!this.configService.isCsFloatConfigured()) {
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
        acceptedJobs: [],
        warnings: [
          'CSFloat sync is disabled until CSFLOAT_API_KEY is configured.',
        ],
      });
    }

    const externalJobId = `csfloat:sync:${context.requestedAt.getTime()}`;
    const syncJobData: CsFloatSyncJobData = {
      trigger: context.trigger,
      mode: context.mode,
      requestedAt: context.requestedAt.toISOString(),
      externalJobId,
    };

    await this.csfloatSyncListingsQueue.add(
      CSFLOAT_SYNC_LISTINGS_JOB_NAME,
      syncJobData,
      {
        jobId: externalJobId,
      },
    );
    const jobRunId = await this.sourceOperationsService.ensureQueuedJobRun({
      source: 'csfloat',
      queueName: CSFLOAT_SYNC_LISTINGS_JOB_NAME,
      jobName: CSFLOAT_SYNC_LISTINGS_JOB_NAME,
      externalJobId,
      payload: this.serializeJson(syncJobData),
    });
    await this.sourceOperationsService.upsertSyncStatus({
      source: 'csfloat',
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
          queueName: CSFLOAT_SYNC_LISTINGS_JOB_NAME,
          jobName: CSFLOAT_SYNC_LISTINGS_JOB_NAME,
          externalJobId,
          jobRunId,
        },
      ],
      warnings: [
        'CSFloat sync is queued asynchronously. Opportunity scans must read cached market state rather than calling CSFloat live.',
      ],
    });
  }

  private serializeJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
