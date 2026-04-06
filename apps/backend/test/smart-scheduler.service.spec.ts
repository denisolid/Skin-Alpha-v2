import {
  createUnknownSourceHealth,
  type SourceHealthModel,
} from '../src/modules/source-adapters/domain/source-health.model';
import {
  createUnknownSourceRateLimitState,
  type SourceRateLimitStateModel,
} from '../src/modules/source-adapters/domain/source-rate-limit-state.model';
import type { SourceAdapter } from '../src/modules/source-adapters/domain/source-adapter.interface';
import type { SourceAdapterKey } from '../src/modules/source-adapters/domain/source-adapter.types';
import { OPPORTUNITY_RESCAN_QUEUE_NAME } from '../src/modules/jobs/domain/jobs-scheduler.constants';
import { SmartSchedulerService } from '../src/modules/jobs/services/smart-scheduler.service';

function createAdapter(options: {
  key: SourceAdapterKey;
  enabled: boolean;
  health?: SourceHealthModel;
  rateLimitState?: SourceRateLimitStateModel;
}): SourceAdapter {
  return {
    descriptor: {
      key: options.key,
      displayName: options.key,
      category: 'marketplace',
      classification: 'PRIMARY',
      behavior: {
        canDrivePrimaryTruth: true,
        canProvideFallbackPricing: false,
        canProvideQuantitySignals: true,
        canBeUsedForPairBuilding: true,
        canBeUsedForConfirmationOnly: false,
      },
      capabilities: {
        supportsListings: true,
        supportsMarketState: true,
        supportsRawPayloadArchive: true,
        supportsHealthChecks: true,
        supportsPagination: true,
        supportsIncrementalSync: true,
        supportsReferencePricing: false,
      },
      priority: {
        enabled: options.enabled,
        weight: 1,
        fallbackOrder: 1,
      },
    },
    getHealth: jest
      .fn<Promise<SourceHealthModel>, []>()
      .mockResolvedValue(options.health ?? createUnknownSourceHealth()),
    getRateLimitState: jest
      .fn<Promise<SourceRateLimitStateModel>, []>()
      .mockResolvedValue(
        options.rateLimitState ?? createUnknownSourceRateLimitState(),
      ),
    sync: jest.fn(),
  };
}

describe('SmartSchedulerService', () => {
  const baseConfig = {
    schedulerEnabled: true,
    schedulerFailureCooldownMs: 12 * 60 * 1000,
    schedulerDegradedIntervalMultiplier: 1.5,
    schedulerDownIntervalMultiplier: 2.25,
    schedulerCsFloatMinIntervalMs: 4 * 60 * 1000,
    schedulerSteamSnapshotMinIntervalMs: 7 * 60 * 1000,
    schedulerSkinportMinIntervalMs: 7 * 60 * 1000,
    schedulerBitSkinsMinIntervalMs: 8 * 60 * 1000,
    schedulerBackupSourceMinIntervalMs: 15 * 60 * 1000,
    schedulerMarketStateRebuildEnabled: false,
    schedulerMarketStateRebuildMinIntervalMs: 180 * 60 * 1000,
    schedulerOpportunityRescanEnabled: false,
    schedulerOpportunityRescanMinIntervalMs: 20 * 60 * 1000,
    schedulerOpportunityRescanMinChangedStates: 24,
    schedulerOpportunityRescanMinHotUpdates: 6,
  } as const;

  it('skips source sync when the last successful sync is still fresh enough', async () => {
    const now = new Date();
    const logger = {
      log: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const prismaService = {
      marketState: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
    };
    const adapters: SourceAdapter[] = [
      createAdapter({
        key: 'csfloat',
        enabled: true,
        health: {
          status: 'healthy',
          checkedAt: now,
          consecutiveFailures: 0,
          lastSuccessfulSyncAt: new Date(now.getTime() - 60 * 1000),
        },
        rateLimitState: {
          status: 'available',
          checkedAt: now,
        },
      }),
      createAdapter({ key: 'steam-snapshot', enabled: false }),
      createAdapter({ key: 'skinport', enabled: false }),
      createAdapter({ key: 'bitskins', enabled: false }),
      createAdapter({ key: 'backup-aggregator', enabled: false }),
    ];
    const sourceOperationsService = {
      hasActiveSyncJob: jest.fn().mockResolvedValue(false),
    };
    const sourceSyncDispatchService = {
      dispatchScheduledSync: jest.fn(),
    };
    const jobRunService = {
      hasActiveJob: jest.fn(),
      getLatestSuccessfulJob: jest.fn(),
    };
    const jobsMaintenanceDispatchService = {
      enqueueMarketStateRebuild: jest.fn(),
      enqueueOpportunityRescan: jest.fn(),
    };
    const schedulerLockService = {
      acquire: jest.fn().mockResolvedValue(true),
    };
    const scannerUniverseService = {
      getScannerUniverse: jest.fn(),
    };

    const service = new SmartSchedulerService(
      logger as never,
      baseConfig as never,
      prismaService as never,
      adapters,
      sourceOperationsService as never,
      sourceSyncDispatchService as never,
      jobRunService as never,
      jobsMaintenanceDispatchService as never,
      schedulerLockService as never,
      scannerUniverseService as never,
    );

    await service.runTick();

    expect(
      sourceSyncDispatchService.dispatchScheduledSync,
    ).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('Scheduler skipped csfloat: fresh_enough_until_'),
      SmartSchedulerService.name,
    );
  });

  it('enqueues opportunity rescan when changed-state threshold is met', async () => {
    const lastSuccessfulRescanAt = new Date(Date.now() - 25 * 60 * 1000);
    const logger = {
      log: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const prismaService = {
      marketState: {
        count: jest.fn().mockResolvedValue(32),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const adapters: SourceAdapter[] = [
      createAdapter({ key: 'csfloat', enabled: false }),
      createAdapter({ key: 'steam-snapshot', enabled: false }),
      createAdapter({ key: 'skinport', enabled: false }),
      createAdapter({ key: 'bitskins', enabled: false }),
      createAdapter({ key: 'backup-aggregator', enabled: false }),
    ];
    const sourceOperationsService = {
      hasActiveSyncJob: jest.fn().mockResolvedValue(false),
    };
    const sourceSyncDispatchService = {
      dispatchScheduledSync: jest.fn(),
    };
    const jobRunService = {
      hasActiveJob: jest.fn().mockResolvedValue(false),
      getLatestSuccessfulJob: jest.fn((queueName: string) =>
        queueName === OPPORTUNITY_RESCAN_QUEUE_NAME
          ? Promise.resolve({
              id: 'rescan-job-run',
              finishedAt: lastSuccessfulRescanAt,
            })
          : Promise.resolve(null),
      ),
    };
    const jobsMaintenanceDispatchService = {
      enqueueMarketStateRebuild: jest.fn(),
      enqueueOpportunityRescan: jest.fn().mockResolvedValue({
        jobRunId: 'rescan-job-run',
        externalJobId: 'scheduled:opportunity-rescan:test',
      }),
    };
    const schedulerLockService = {
      acquire: jest.fn().mockResolvedValue(true),
    };
    const scannerUniverseService = {
      getScannerUniverse: jest.fn().mockResolvedValue({
        generatedAt: new Date(),
        summary: {
          hot: 0,
          warm: 0,
          cold: 0,
          overridden: 0,
        },
        items: [],
      }),
    };
    const config = {
      ...baseConfig,
      schedulerOpportunityRescanEnabled: true,
    };

    const service = new SmartSchedulerService(
      logger as never,
      config as never,
      prismaService as never,
      adapters,
      sourceOperationsService as never,
      sourceSyncDispatchService as never,
      jobRunService as never,
      jobsMaintenanceDispatchService as never,
      schedulerLockService as never,
      scannerUniverseService as never,
    );

    await service.runTick();

    expect(
      jobsMaintenanceDispatchService.enqueueOpportunityRescan,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        changedStateCount: 32,
        updatedHotItemCount: 0,
      }),
    );
    expect(
      sourceSyncDispatchService.dispatchScheduledSync,
    ).not.toHaveBeenCalled();
  });
});
