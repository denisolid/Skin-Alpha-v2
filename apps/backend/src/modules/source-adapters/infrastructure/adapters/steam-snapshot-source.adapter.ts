import { SyncStatus, SyncType, type Prisma } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import type {
  SourceAdapterDescriptor,
  SourceSyncContext,
} from '../../domain/source-adapter.interface';
import {
  STEAM_SNAPSHOT_SYNC_JOB_NAME,
  STEAM_SNAPSHOT_SYNC_QUEUE,
} from '../../domain/steam-snapshot.constants';
import type { SourceJobQueue } from '../../domain/source-job-queue.port';
import type { SourceRateLimitStateModel } from '../../domain/source-rate-limit-state.model';
import {
  createEmptySourceSyncResult,
  type SourceSyncResultDto,
} from '../../dto/source-sync-result.dto';
import type { SteamSnapshotSyncJobData } from '../../dto/steam-snapshot.job.dto';
import { SourceOperationsService } from '../../services/source-operations.service';
import { SteamSnapshotFallbackService } from '../../services/steam-snapshot-fallback.service';
import { SteamSnapshotRateLimitService } from '../../services/steam-snapshot-rate-limit.service';
import { BaseSourceAdapter } from './base-source.adapter';

@Injectable()
export class SteamSnapshotSourceAdapter extends BaseSourceAdapter {
  constructor(
    @Inject(STEAM_SNAPSHOT_SYNC_QUEUE)
    private readonly steamSnapshotSyncQueue: SourceJobQueue<SteamSnapshotSyncJobData>,
    @Inject(SourceOperationsService)
    private readonly sourceOperationsService: SourceOperationsService,
    @Inject(SteamSnapshotFallbackService)
    private readonly steamSnapshotFallbackService: SteamSnapshotFallbackService,
    @Inject(SteamSnapshotRateLimitService)
    private readonly steamSnapshotRateLimitService: SteamSnapshotRateLimitService,
  ) {
    super();
  }

  override readonly descriptor = {
    key: 'steam-snapshot',
    displayName: 'Steam Snapshot',
    category: 'snapshot',
    classification: 'OPTIONAL',
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
      tier: 'secondary',
      weight: 70,
      enabled: true,
      fallback: {
        fallbackSources: ['backup-aggregator'],
        activateAfterConsecutiveFailures: 1,
        cooldownSeconds: 180,
      },
    },
  } as const satisfies SourceAdapterDescriptor;

  override getHealth() {
    return this.steamSnapshotFallbackService.getSourceHealth();
  }

  override getRateLimitState(): Promise<SourceRateLimitStateModel> {
    return this.steamSnapshotRateLimitService.getState();
  }

  override async sync(
    context: SourceSyncContext,
  ): Promise<SourceSyncResultDto> {
    const externalJobId = `steam-snapshot:sync:${Math.floor(context.requestedAt.getTime() / 300_000)}`;
    const syncJobData: SteamSnapshotSyncJobData = {
      trigger: context.trigger,
      mode: context.mode,
      requestedAt: context.requestedAt.toISOString(),
      externalJobId,
    };

    await this.steamSnapshotSyncQueue.add(
      STEAM_SNAPSHOT_SYNC_JOB_NAME,
      syncJobData,
      {
        // Coalesce repeated Steam sync requests into a conservative 5 minute bucket.
        jobId: externalJobId,
      },
    );
    const jobRunId = await this.sourceOperationsService.ensureQueuedJobRun({
      source: 'steam-snapshot',
      queueName: STEAM_SNAPSHOT_SYNC_JOB_NAME,
      jobName: STEAM_SNAPSHOT_SYNC_JOB_NAME,
      externalJobId,
      payload: this.serializeJson(syncJobData),
    });
    await this.sourceOperationsService.upsertSyncStatus({
      source: 'steam-snapshot',
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
          queueName: STEAM_SNAPSHOT_SYNC_JOB_NAME,
          jobName: STEAM_SNAPSHOT_SYNC_JOB_NAME,
          externalJobId,
          jobRunId,
        },
      ],
      warnings: [
        'Steam snapshots are refreshed asynchronously in priority batches. Scanner reads cached Steam market state or the last good stale fallback snapshot only.',
      ],
    });
  }

  private serializeJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
