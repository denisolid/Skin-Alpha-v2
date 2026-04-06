import {
  ArchiveEntityType,
  HealthStatus,
  SyncStatus,
  SyncType,
  type Prisma,
} from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../infrastructure/config/app-config.service';
import {
  createUnknownSourceRateLimitState,
  type SourceRateLimitStateModel,
} from '../domain/source-rate-limit-state.model';
import {
  BackupReferenceProviderThrottleError,
  type BackupReferenceProvider,
} from '../domain/backup-reference-provider.interface';
import { BACKUP_AGGREGATOR_SYNC_QUEUE_NAME } from '../domain/backup-aggregator.constants';
import type { BackupReferenceObservationDto } from '../dto/backup-aggregator.dto';
import type { BackupAggregatorSyncJobData } from '../dto/backup-aggregator.job.dto';
import type { NormalizedMarketStateDto } from '../dto/normalized-market-state.dto';
import { MarketStateUpdaterService } from './market-state-updater.service';
import { RawPayloadArchiveService } from './raw-payload-archive.service';
import { SourceOperationsService } from './source-operations.service';
import { BackupAggregatorProviderRegistry } from './backup-aggregator-provider.registry';
import { BackupAggregatorUniverseService } from './backup-aggregator-universe.service';

interface AggregatedBackupState {
  readonly rawPayloadArchiveId?: string;
  readonly marketState: NormalizedMarketStateDto;
}

@Injectable()
export class BackupAggregatorSyncService {
  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
    @Inject(RawPayloadArchiveService)
    private readonly rawPayloadArchiveService: RawPayloadArchiveService,
    @Inject(MarketStateUpdaterService)
    private readonly marketStateUpdaterService: MarketStateUpdaterService,
    @Inject(SourceOperationsService)
    private readonly sourceOperationsService: SourceOperationsService,
    @Inject(BackupAggregatorProviderRegistry)
    private readonly providerRegistry: BackupAggregatorProviderRegistry,
    @Inject(BackupAggregatorUniverseService)
    private readonly backupAggregatorUniverseService: BackupAggregatorUniverseService,
  ) {}

  async getHealth() {
    const baseHealth =
      await this.sourceOperationsService.getSourceHealth('backup-aggregator');
    const enabledProviders = this.providerRegistry
      .listEnabled()
      .map((provider) => provider.descriptor.key);

    return {
      ...baseHealth,
      detail: JSON.stringify({
        enabledProviders,
        sourceRole: 'reference-only',
        note: 'Backup aggregator prices are for fallback pricing and sanity checks only.',
      }),
    };
  }

  async getRateLimitState(): Promise<SourceRateLimitStateModel> {
    const enabledProviders = this.providerRegistry.listEnabled();

    if (enabledProviders.length === 0) {
      return createUnknownSourceRateLimitState();
    }

    const states = await Promise.all(
      enabledProviders.map((provider) => provider.getRateLimitState()),
    );

    return states.reduce((worstState, candidateState) =>
      this.compareRateLimitSeverity(candidateState, worstState) > 0
        ? candidateState
        : worstState,
    );
  }

  async syncReferenceBatches(
    input: BackupAggregatorSyncJobData,
  ): Promise<void> {
    const payload = this.serializeJson({
      ...(input.batchBudget !== undefined
        ? { batchBudget: input.batchBudget }
        : {}),
      ...(input.targetItemVariantIds
        ? { targetItemVariantIds: [...input.targetItemVariantIds] }
        : {}),
      ...(input.providerKeys ? { providerKeys: [...input.providerKeys] } : {}),
    });
    const jobRunId = input.externalJobId
      ? await this.sourceOperationsService.startQueuedJobRun({
          source: 'backup-aggregator',
          queueName: BACKUP_AGGREGATOR_SYNC_QUEUE_NAME,
          jobName: BACKUP_AGGREGATOR_SYNC_QUEUE_NAME,
          externalJobId: input.externalJobId,
          ...(payload ? { payload } : {}),
        })
      : await this.sourceOperationsService.startJobRun({
          source: 'backup-aggregator',
          queueName: BACKUP_AGGREGATOR_SYNC_QUEUE_NAME,
          jobName: BACKUP_AGGREGATOR_SYNC_QUEUE_NAME,
          ...(payload ? { payload } : {}),
        });

    try {
      if (!this.configService.isBackupAggregatorEnabled()) {
        await this.cancelSync(jobRunId, {
          reason: 'backup_aggregator_disabled',
        });

        return;
      }

      const providers = this.providerRegistry.listEnabled(input.providerKeys);

      if (providers.length === 0) {
        await this.cancelSync(jobRunId, {
          reason: 'backup_aggregator_no_enabled_providers',
        });

        return;
      }

      const batches =
        await this.backupAggregatorUniverseService.selectPriorityBatches({
          ...(input.batchBudget !== undefined
            ? { batchBudget: input.batchBudget }
            : {}),
          ...(input.targetItemVariantIds
            ? { targetItemVariantIds: input.targetItemVariantIds }
            : {}),
          ...(input.force !== undefined ? { force: input.force } : {}),
        });

      if (batches.length === 0) {
        await this.cancelSync(jobRunId, {
          reason: 'backup_aggregator_no_candidates',
        });

        return;
      }

      const runningDetails = this.serializeJson({
        providerKeys: providers.map((provider) => provider.descriptor.key),
        batchCount: batches.length,
        targetCount: batches.reduce(
          (total, batch) => total + batch.targets.length,
          0,
        ),
      });

      await this.sourceOperationsService.upsertSyncStatus({
        source: 'backup-aggregator',
        syncType: SyncType.MARKET_STATE,
        status: SyncStatus.RUNNING,
        jobRunId,
        ...(runningDetails ? { details: runningDetails } : {}),
      });

      const observations: BackupReferenceObservationDto[] = [];
      const warnings: string[] = [];
      let archivedPayloadCount = 0;
      let providerFailureCount = 0;

      for (const provider of providers) {
        const providerResult = await this.processProviderBatches(
          provider,
          batches,
          input.requestedAt,
          jobRunId,
        );

        observations.push(...providerResult.observations);
        warnings.push(...providerResult.warnings);
        archivedPayloadCount += providerResult.archivedPayloadCount;
        providerFailureCount += providerResult.failureCount;
      }

      const aggregatedStates = this.aggregateObservations(observations);
      let updatedStateCount = 0;
      let snapshotCount = 0;

      for (const [
        rawPayloadArchiveId,
        groupedStates,
      ] of this.groupStatesByArchive(aggregatedStates)) {
        const updateResult =
          await this.marketStateUpdaterService.updateLatestStateBatch({
            source: 'backup-aggregator',
            marketStates: groupedStates.map((state) => state.marketState),
            ...(rawPayloadArchiveId ? { rawPayloadArchiveId } : {}),
          });

        updatedStateCount += updateResult.upsertedStateCount;
        snapshotCount += updateResult.snapshotCount;
      }

      const details = this.serializeJson({
        providerKeys: providers.map((provider) => provider.descriptor.key),
        archivedPayloadCount,
        observationCount: observations.length,
        updatedStateCount,
        snapshotCount,
        providerFailureCount,
        warnings,
      });
      const degraded = providerFailureCount > 0 || warnings.length > 0;

      if (updatedStateCount > 0) {
        await this.sourceOperationsService.completeJobRun({
          jobRunId,
          ...(details ? { result: details } : {}),
        });
        await this.sourceOperationsService.upsertSyncStatus({
          source: 'backup-aggregator',
          syncType: SyncType.MARKET_STATE,
          status: degraded ? SyncStatus.DEGRADED : SyncStatus.SUCCEEDED,
          jobRunId,
          markSuccessful: true,
          ...(details ? { details } : {}),
        });
        await this.sourceOperationsService.recordHealthMetric({
          source: 'backup-aggregator',
          status: degraded ? HealthStatus.DEGRADED : HealthStatus.OK,
          availabilityRatio:
            observations.length > 0
              ? updatedStateCount / observations.length
              : 0,
          errorRate:
            providers.length > 0 ? providerFailureCount / providers.length : 0,
          ...(details ? { details } : {}),
        });

        return;
      }

      await this.sourceOperationsService.failJobRun({
        jobRunId,
        errorMessage:
          'Backup aggregator completed without producing any reference states.',
        ...(details ? { result: details } : {}),
      });
      await this.sourceOperationsService.upsertSyncStatus({
        source: 'backup-aggregator',
        syncType: SyncType.MARKET_STATE,
        status: SyncStatus.FAILED,
        jobRunId,
        markFailed: true,
        ...(details ? { details } : {}),
      });
      await this.sourceOperationsService.recordHealthMetric({
        source: 'backup-aggregator',
        status: HealthStatus.FAILED,
        availabilityRatio: 0,
        errorRate: 1,
        ...(details ? { details } : {}),
      });
    } catch (error) {
      const details = this.serializeJson({
        error:
          error instanceof Error
            ? error.message
            : 'Unknown backup aggregator error',
      });

      await this.sourceOperationsService.failJobRun({
        jobRunId,
        errorMessage:
          error instanceof Error
            ? error.message
            : 'Unknown backup aggregator error',
        ...(details ? { result: details } : {}),
      });
      await this.sourceOperationsService.upsertSyncStatus({
        source: 'backup-aggregator',
        syncType: SyncType.MARKET_STATE,
        status: SyncStatus.FAILED,
        jobRunId,
        markFailed: true,
        ...(details ? { details } : {}),
      });
      await this.sourceOperationsService.recordHealthMetric({
        source: 'backup-aggregator',
        status: HealthStatus.FAILED,
        availabilityRatio: 0,
        errorRate: 1,
        ...(details ? { details } : {}),
      });

      throw error;
    }
  }

  private async processProviderBatches(
    provider: BackupReferenceProvider,
    batches: readonly {
      readonly batchId: string;
      readonly targets: readonly {
        readonly canonicalItemId: string;
        readonly itemVariantId: string;
        readonly marketHashName: string;
        readonly priorityScore: number;
        readonly priorityReason: string;
        readonly backupObservedAt?: string;
      }[];
    }[],
    requestedAt: string,
    jobRunId: string,
  ): Promise<{
    readonly observations: readonly BackupReferenceObservationDto[];
    readonly warnings: readonly string[];
    readonly archivedPayloadCount: number;
    readonly failureCount: number;
  }> {
    const observations: BackupReferenceObservationDto[] = [];
    const warnings: string[] = [];
    let archivedPayloadCount = 0;
    let failureCount = 0;

    for (const batch of batches) {
      try {
        const fetchResult = await provider.fetchBatch({
          batch,
          requestedAt,
          jobRunId,
        });
        const archive = await this.rawPayloadArchiveService.archive({
          source: 'backup-aggregator',
          endpointName: fetchResult.endpointName,
          observedAt: fetchResult.observedAt,
          payload: fetchResult.payload,
          jobRunId,
          externalId: `${provider.descriptor.key}:${batch.batchId}`,
          entityType: ArchiveEntityType.SOURCE_SYNC,
          contentType: 'application/json',
          ...(fetchResult.httpStatus !== undefined
            ? { httpStatus: fetchResult.httpStatus }
            : {}),
        });
        const normalizedPayload = provider.normalizeArchivedPayload(archive);

        observations.push(...normalizedPayload.observations);
        warnings.push(...fetchResult.warnings, ...normalizedPayload.warnings);
        archivedPayloadCount += 1;
      } catch (error) {
        failureCount += 1;

        if (error instanceof BackupReferenceProviderThrottleError) {
          warnings.push(
            `${provider.descriptor.displayName} is throttled for ${error.retryAfterSeconds ?? 'an unknown'} seconds.`,
          );

          break;
        }

        warnings.push(
          `${provider.descriptor.displayName} batch ${batch.batchId} failed: ${error instanceof Error ? error.message : 'Unknown provider error'}.`,
        );
      }
    }

    return {
      observations,
      warnings,
      archivedPayloadCount,
      failureCount,
    };
  }

  private aggregateObservations(
    observations: readonly BackupReferenceObservationDto[],
  ): readonly AggregatedBackupState[] {
    const observationsByVariant = new Map<
      string,
      BackupReferenceObservationDto[]
    >();

    for (const observation of observations) {
      const currentObservations =
        observationsByVariant.get(observation.itemVariantId) ?? [];

      currentObservations.push(observation);
      observationsByVariant.set(observation.itemVariantId, currentObservations);
    }

    return [...observationsByVariant.values()].map((variantObservations) => {
      const sortedPrices = variantObservations
        .map((observation) => observation.backupPriceMinor)
        .sort((left, right) => left - right);
      const referencePriceMinor =
        sortedPrices[Math.floor(sortedPrices.length / 2)] ??
        sortedPrices[0] ??
        0;
      const listedQuantities = variantObservations
        .map((observation) => observation.listedQuantity)
        .filter((value): value is number => value !== undefined);
      const latestObservation = [...variantObservations].sort(
        (left, right) => right.observedAt.getTime() - left.observedAt.getTime(),
      )[0];
      if (!latestObservation) {
        throw new Error(
          'Backup aggregator encountered an empty observation group.',
        );
      }
      const providerKeys = [
        ...new Set(
          variantObservations.map((observation) => observation.providerKey),
        ),
      ];
      const confidence = Number(
        Math.min(
          0.5,
          variantObservations.reduce(
            (total, observation) => total + observation.sourceConfidence,
            0,
          ) / Math.max(1, variantObservations.length),
        ).toFixed(4),
      );
      const liquidityScore = Number(
        (
          variantObservations.reduce(
            (total, observation) => total + (observation.liquidityScore ?? 0),
            0,
          ) / Math.max(1, variantObservations.length)
        ).toFixed(4),
      );

      return {
        rawPayloadArchiveId: latestObservation.rawPayloadArchiveId,
        marketState: {
          source: 'backup-aggregator',
          canonicalItemId: latestObservation.canonicalItemId,
          itemVariantId: latestObservation.itemVariantId,
          capturedAt: latestObservation.observedAt,
          currency: latestObservation.currency,
          lowestAskMinor: referencePriceMinor,
          medianAskMinor: referencePriceMinor,
          ...(listedQuantities.length > 0
            ? { listingCount: Math.max(...listedQuantities) }
            : {}),
          sampleSize: variantObservations.length,
          confidence,
          liquidityScore,
          // Reference-only states are intentionally conservative. The scanner can
          // use them for resilience and sanity checks, but not as primary truth.
          metadata: {
            referenceOnly: true,
            notPrimaryTruth: true,
            providerKeys,
            providerCount: providerKeys.length,
            priceSelection: 'median-across-backup-providers',
            ...(sortedPrices[0] !== undefined
              ? { lowestObservedAskMinor: sortedPrices[0] }
              : {}),
          },
        },
      };
    });
  }

  private groupStatesByArchive(
    states: readonly AggregatedBackupState[],
  ): ReadonlyMap<string | undefined, readonly AggregatedBackupState[]> {
    const statesByArchive = new Map<
      string | undefined,
      AggregatedBackupState[]
    >();

    for (const state of states) {
      const currentStates =
        statesByArchive.get(state.rawPayloadArchiveId) ?? [];

      currentStates.push(state);
      statesByArchive.set(state.rawPayloadArchiveId, currentStates);
    }

    return statesByArchive;
  }

  private async cancelSync(jobRunId: string, details: unknown): Promise<void> {
    const result = this.serializeJson(details);

    await this.sourceOperationsService.cancelJobRun({
      jobRunId,
      ...(result ? { result } : {}),
    });
    await this.sourceOperationsService.upsertSyncStatus({
      source: 'backup-aggregator',
      syncType: SyncType.MARKET_STATE,
      status: SyncStatus.IDLE,
      jobRunId,
      ...(result ? { details: result } : {}),
    });
  }

  private compareRateLimitSeverity(
    left: SourceRateLimitStateModel,
    right: SourceRateLimitStateModel,
  ): number {
    const severityOrder: Record<SourceRateLimitStateModel['status'], number> = {
      unknown: 0,
      available: 1,
      limited: 2,
      cooldown: 3,
      blocked: 4,
    };

    return severityOrder[left.status] - severityOrder[right.status];
  }

  private serializeJson(value: unknown): Prisma.InputJsonValue | null {
    if (value === undefined) {
      return null;
    }

    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
