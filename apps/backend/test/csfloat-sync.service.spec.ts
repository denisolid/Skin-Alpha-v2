import type { Prisma } from '@prisma/client';

import { CsFloatSyncService } from '../src/modules/source-adapters/services/csfloat-sync.service';

describe('CsFloatSyncService', () => {
  it('does not treat a budget-limited listings window as a full snapshot rebuild', async () => {
    const dependencies = createDependencies({
      nextCursor: 'cursor:next',
    });
    const service = createService(dependencies);

    await service.syncListings({
      trigger: 'manual',
      mode: 'full-snapshot',
      requestedAt: '2026-04-11T18:23:31.119Z',
      externalJobId: 'csfloat:sync:test-partial',
      pageBudget: 1,
      detailBudget: 0,
    });

    expect(
      dependencies.csfloatMarketStateService.reconcileAndRebuild,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        fullSnapshot: false,
        normalizedTitles: ['AK-47 | Slate (Factory New)'],
      }),
    );
  });

  it('keeps full snapshot rebuilds for fully drained unfiltered syncs', async () => {
    const dependencies = createDependencies();
    const service = createService(dependencies);

    await service.syncListings({
      trigger: 'manual',
      mode: 'full-snapshot',
      requestedAt: '2026-04-11T18:23:31.119Z',
      externalJobId: 'csfloat:sync:test-complete',
      pageBudget: 1,
      detailBudget: 0,
    });

    expect(
      dependencies.csfloatMarketStateService.reconcileAndRebuild,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        fullSnapshot: true,
        normalizedTitles: ['AK-47 | Slate (Factory New)'],
      }),
    );
  });
});

function createService(dependencies: ReturnType<typeof createDependencies>) {
  return new CsFloatSyncService(
    dependencies.configService as never,
    dependencies.rawPayloadArchiveService as never,
    dependencies.pendingSourceMappingService as never,
    dependencies.sourceFetchJobService as never,
    dependencies.sourceFreshnessService as never,
    dependencies.sourceListingStorageService as never,
    dependencies.sourceOperationsService as never,
    dependencies.sourcePayloadNormalizationService as never,
    dependencies.sourceProvenanceService as never,
    dependencies.csfloatDetailPolicyService as never,
    dependencies.csfloatHttpClientService as never,
    dependencies.csfloatMarketStateService as never,
    dependencies.csfloatRateLimitService as never,
    dependencies.csfloatFetchListingDetailQueue as never,
  );
}

function createDependencies(overrides?: { readonly nextCursor?: string }) {
  const normalizedPayload = {
    rawPayloadArchiveId: 'archive-1',
    source: 'csfloat',
    endpointName: 'csfloat-listings',
    observedAt: new Date('2026-04-11T18:23:31.119Z'),
    payloadHash: 'payload-hash',
    fetchJobId: 'fetch-job-1',
    listings: [
      {
        source: 'csfloat',
        externalListingId: 'listing-1',
        sourceItemId: 'asset-1',
        canonicalItemId: 'canonical-item-1',
        itemVariantId: 'item-variant-1',
        title: 'AK-47 | Slate (Factory New)',
        observedAt: new Date('2026-04-11T18:23:31.119Z'),
        currency: 'USD',
        priceMinor: 1250,
        quantityAvailable: 1,
        isStatTrak: false,
        isSouvenir: false,
        metadata: {} as Prisma.JsonValue,
      },
    ],
    marketStates: [],
    warnings: [],
  };

  return {
    configService: {
      isCsFloatConfigured: jest.fn().mockReturnValue(true),
      csfloatListingsPageBudget: 10,
      csfloatDetailJobBudget: 5,
      csfloatListingsPageLimit: 50,
      csfloatCurrency: 'USD',
      csfloatHotUniverseSyncEnabled: true,
      csfloatFullSyncEnabled: true,
    },
    rawPayloadArchiveService: {
      archive: jest.fn().mockResolvedValue({
        id: 'archive-1',
      }),
    },
    pendingSourceMappingService: {
      captureFromPayload: jest.fn().mockResolvedValue(0),
    },
    sourceFetchJobService: {
      recordNormalization: jest.fn().mockResolvedValue(undefined),
    },
    sourceFreshnessService: {
      recordNormalizedPayload: jest.fn().mockResolvedValue(undefined),
    },
    sourceListingStorageService: {
      storeNormalizedListings: jest.fn().mockResolvedValue({
        storedCount: 1,
        sourceListingIds: ['source-listing-1'],
      }),
    },
    sourceOperationsService: {
      startQueuedJobRun: jest.fn().mockResolvedValue('job-run-1'),
      startJobRun: jest.fn().mockResolvedValue('job-run-1'),
      upsertSyncStatus: jest.fn().mockResolvedValue(undefined),
      completeJobRun: jest.fn().mockResolvedValue(undefined),
      recordHealthMetric: jest.fn().mockResolvedValue(undefined),
      failJobRun: jest.fn().mockResolvedValue(undefined),
      cancelJobRun: jest.fn().mockResolvedValue(undefined),
    },
    sourcePayloadNormalizationService: {
      normalizeArchivedPayload: jest.fn().mockResolvedValue(normalizedPayload),
    },
    sourceProvenanceService: {
      recordListings: jest.fn().mockResolvedValue(undefined),
    },
    csfloatDetailPolicyService: {
      determineReason: jest.fn().mockReturnValue(null),
    },
    csfloatHttpClientService: {
      fetchListingsPage: jest.fn().mockResolvedValue({
        listings: [
          {
            id: 'listing-1',
            price: 1250,
            item: {
              assetId: 'asset-1',
              marketHashName: 'AK-47 | Slate (Factory New)',
            },
          },
        ],
        pagination: {
          limit: 50,
          page: 1,
          ...(overrides?.nextCursor ? { nextCursor: overrides.nextCursor } : {}),
        },
      }),
    },
    csfloatMarketStateService: {
      reconcileAndRebuild: jest.fn().mockResolvedValue({
        removedCount: 0,
        rebuiltStateCount: 1,
      }),
    },
    csfloatRateLimitService: {
      reserve: jest.fn().mockResolvedValue({
        granted: true,
      }),
      markRateLimited: jest.fn().mockResolvedValue(undefined),
    },
    csfloatFetchListingDetailQueue: {
      add: jest.fn().mockResolvedValue(undefined),
    },
  };
}
