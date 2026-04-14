import { OpportunityFeedService } from '../src/modules/opportunities/services/opportunity-feed.service';

describe('OpportunityFeedService', () => {
  it('separates zero-entry persisted feeds from materialization_not_run', async () => {
    const opportunitiesRepository = {
      listMaterializedOpportunities: jest.fn().mockResolvedValue([]),
      findLatestOpportunityRescan: jest.fn().mockResolvedValue(null),
    };
    const scannerUniverseService = {
      getScannerUniverseMap: jest.fn().mockResolvedValue(new Map()),
      summarizeOverlapReadiness: jest.fn().mockResolvedValue({
        totalOverlapVariantCount: 0,
        usableOverlapVariantCount: 0,
        freshOverlapVariantCount: 0,
      }),
    };
    const marketFreshnessPolicyService = {
      evaluateSourceState: jest.fn(),
    };
    const readPathDegradationService = {
      trip: jest.fn(),
    };
    const service = new OpportunityFeedService(
      opportunitiesRepository as never,
      scannerUniverseService as never,
      {} as never,
      marketFreshnessPolicyService as never,
      readPathDegradationService as never,
    );

    const feed = await service.getPublicFeed();

    expect(feed.items).toEqual([]);
    expect(feed.diagnostics.scannedVariantCount).toBe(0);
    expect(feed.diagnostics.evaluatedPairCount).toBe(0);
    expect(feed.diagnostics.visibleFeedCount).toBe(0);
    expect(feed.diagnostics.pipelineDiagnostics).toEqual(
      expect.arrayContaining([
        {
          key: 'materialization_not_run',
          count: 1,
        },
      ]),
    );
  });

  it('flags overlap_exists_materialization_not_run when overlap exists without a successful rescan', async () => {
    const opportunitiesRepository = {
      listMaterializedOpportunities: jest.fn().mockResolvedValue([]),
      findLatestOpportunityRescan: jest.fn().mockResolvedValue(null),
    };
    const scannerUniverseService = {
      getScannerUniverseMap: jest.fn().mockResolvedValue(new Map()),
      summarizeOverlapReadiness: jest.fn().mockResolvedValue({
        totalOverlapVariantCount: 12,
        usableOverlapVariantCount: 4,
        freshOverlapVariantCount: 3,
      }),
    };
    const service = new OpportunityFeedService(
      opportunitiesRepository as never,
      scannerUniverseService as never,
      {} as never,
      { evaluateSourceState: jest.fn() } as never,
      { trip: jest.fn() } as never,
    );

    const feed = await service.getPublicFeed();

    expect(feed.diagnostics.pipelineDiagnostics).toEqual(
      expect.arrayContaining([
        {
          key: 'overlap_exists_materialization_not_run',
          count: 1,
        },
      ]),
    );
  });

  it('flags overlap_exists_all_candidates_stale when overlap remains but no usable pairs survive freshness', async () => {
    const opportunitiesRepository = {
      listMaterializedOpportunities: jest.fn().mockResolvedValue([]),
      findLatestOpportunityRescan: jest.fn().mockResolvedValue(null),
    };
    const scannerUniverseService = {
      getScannerUniverseMap: jest.fn().mockResolvedValue(new Map()),
      summarizeOverlapReadiness: jest.fn().mockResolvedValue({
        totalOverlapVariantCount: 7,
        usableOverlapVariantCount: 0,
        freshOverlapVariantCount: 0,
      }),
    };
    const service = new OpportunityFeedService(
      opportunitiesRepository as never,
      scannerUniverseService as never,
      {} as never,
      { evaluateSourceState: jest.fn() } as never,
      { trip: jest.fn() } as never,
    );

    const feed = await service.getPublicFeed();

    expect(feed.diagnostics.pipelineDiagnostics).toEqual(
      expect.arrayContaining([
        {
          key: 'overlap_exists_all_candidates_stale',
          count: 1,
        },
      ]),
    );
  });

  it('flags materialized_rows_absent when the latest successful rescan persisted no opportunities', async () => {
    const opportunitiesRepository = {
      listMaterializedOpportunities: jest.fn().mockResolvedValue([]),
      findLatestOpportunityRescan: jest.fn().mockResolvedValue({
        completedAt: new Date('2026-04-14T20:00:00.000Z'),
        result: {
          scannedVariantCount: 110,
          persistedOpportunityCount: 0,
          variantFunnel: {
            withEvaluatedPairs: 18,
            withPairablePairs: 6,
          },
          pairFunnel: {
            evaluated: 42,
            blocked: 4,
            listedExitOnly: 3,
            softListedExitOnly: 2,
            pairable: 6,
            buySourceHasNoAsk: 1,
            sellSourceHasNoExitSignal: 1,
            strictVariantKeyMissing: 0,
            strictVariantKeyMismatch: 0,
            preScoreRejected: 5,
            nearEqualAfterFees: 2,
            trueNonPositiveEdge: 1,
            negativeExpectedNet: 1,
            confidenceBelowCandidateFloor: 2,
          },
          topRejectReasons: [],
          topBlockerReasons: [],
        },
      }),
    };
    const scannerUniverseService = {
      getScannerUniverseMap: jest.fn().mockResolvedValue(new Map()),
      summarizeOverlapReadiness: jest.fn().mockResolvedValue({
        totalOverlapVariantCount: 12,
        usableOverlapVariantCount: 4,
        freshOverlapVariantCount: 3,
      }),
    };
    const service = new OpportunityFeedService(
      opportunitiesRepository as never,
      scannerUniverseService as never,
      {} as never,
      { evaluateSourceState: jest.fn() } as never,
      { trip: jest.fn() } as never,
    );

    const feed = await service.getPublicFeed();

    expect(feed.diagnostics.pipelineDiagnostics).toEqual(
      expect.arrayContaining([
        {
          key: 'materialized_rows_absent',
          count: 1,
        },
      ]),
    );
  });
});
