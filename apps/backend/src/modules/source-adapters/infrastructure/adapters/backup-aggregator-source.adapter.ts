import { SyncStatus, SyncType, type Prisma } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../../infrastructure/config/app-config.service';
import type {
  SourceAdapterDescriptor,
  SourceSyncContext,
} from '../../domain/source-adapter.interface';
import {
  BACKUP_AGGREGATOR_SYNC_JOB_NAME,
  BACKUP_AGGREGATOR_SYNC_QUEUE,
} from '../../domain/backup-aggregator.constants';
import type { SourceJobQueue } from '../../domain/source-job-queue.port';
import {
  createEmptySourceSyncResult,
  type SourceSyncResultDto,
} from '../../dto/source-sync-result.dto';
import type { BackupAggregatorSyncJobData } from '../../dto/backup-aggregator.job.dto';
import { SourceOperationsService } from '../../services/source-operations.service';
import { BackupAggregatorSyncService } from '../../services/backup-aggregator-sync.service';
import { BackupAggregatorProviderRegistry } from '../../services/backup-aggregator-provider.registry';
import { BaseSourceAdapter } from './base-source.adapter';

@Injectable()
export class BackupAggregatorSourceAdapter extends BaseSourceAdapter {
  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
    @Inject(BACKUP_AGGREGATOR_SYNC_QUEUE)
    private readonly backupAggregatorSyncQueue: SourceJobQueue<BackupAggregatorSyncJobData>,
    @Inject(SourceOperationsService)
    private readonly sourceOperationsService: SourceOperationsService,
    @Inject(BackupAggregatorSyncService)
    private readonly backupAggregatorSyncService: BackupAggregatorSyncService,
    @Inject(BackupAggregatorProviderRegistry)
    private readonly backupAggregatorProviderRegistry: BackupAggregatorProviderRegistry,
  ) {
    super();
  }

  override readonly descriptor = {
    key: 'backup-aggregator',
    displayName: 'Backup Aggregator',
    category: 'aggregator',
    classification: 'REFERENCE',
    behavior: {
      canDrivePrimaryTruth: false,
      canProvideFallbackPricing: true,
      canProvideQuantitySignals: true,
      canBeUsedForPairBuilding: false,
      canBeUsedForConfirmationOnly: true,
    },
    capabilities: {
      supportedSyncModes: ['full-snapshot', 'market-state-only'],
      supportsRawListingSnapshots: false,
      supportsNormalizedListings: false,
      supportsNormalizedMarketState: true,
      supportsIncrementalSync: false,
      supportsFloatMetadata: false,
      supportsPatternMetadata: false,
      supportsPhaseMetadata: false,
      supportsVariantSignals: false,
      supportsRateLimitTelemetry: true,
      supportsHealthChecks: true,
      supportsFallbackRole: true,
    },
    priority: {
      tier: 'backup',
      weight: 50,
      enabled: true,
      fallback: {
        fallbackSources: [],
        activateAfterConsecutiveFailures: 1,
        cooldownSeconds: 300,
      },
    },
  } as const satisfies SourceAdapterDescriptor;

  override getHealth() {
    return this.backupAggregatorSyncService.getHealth();
  }

  override getRateLimitState() {
    return this.backupAggregatorSyncService.getRateLimitState();
  }

  override async sync(
    context: SourceSyncContext,
  ): Promise<SourceSyncResultDto> {
    if (!this.configService.isBackupAggregatorEnabled()) {
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
        warnings: ['Backup aggregator sync is disabled by configuration.'],
      });
    }

    if (this.backupAggregatorProviderRegistry.listEnabled().length === 0) {
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
          'Backup aggregator sync is enabled, but no backup provider is configured.',
        ],
      });
    }

    const externalJobId = `backup-aggregator:sync:${Math.floor(context.requestedAt.getTime() / 600_000)}`;
    const syncJobData: BackupAggregatorSyncJobData = {
      trigger: context.trigger,
      mode: context.mode,
      requestedAt: context.requestedAt.toISOString(),
      externalJobId,
    };

    await this.backupAggregatorSyncQueue.add(
      BACKUP_AGGREGATOR_SYNC_JOB_NAME,
      syncJobData,
      {
        // Coalesce background refreshes so backup reference pricing stays cheap.
        jobId: externalJobId,
      },
    );
    const jobRunId = await this.sourceOperationsService.ensureQueuedJobRun({
      source: 'backup-aggregator',
      queueName: BACKUP_AGGREGATOR_SYNC_JOB_NAME,
      jobName: BACKUP_AGGREGATOR_SYNC_JOB_NAME,
      externalJobId,
      payload: this.serializeJson(syncJobData),
    });
    await this.sourceOperationsService.upsertSyncStatus({
      source: 'backup-aggregator',
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
          syncType: SyncType.MARKET_STATE,
          queueName: BACKUP_AGGREGATOR_SYNC_JOB_NAME,
          jobName: BACKUP_AGGREGATOR_SYNC_JOB_NAME,
          externalJobId,
          jobRunId,
        },
      ],
      warnings: [
        'Backup aggregator data is refreshed asynchronously and must be treated as reference pricing only, never direct primary source truth.',
      ],
    });
  }

  private serializeJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
