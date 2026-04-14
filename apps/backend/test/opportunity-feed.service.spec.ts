import { OpportunityFeedService } from '../src/modules/opportunities/services/opportunity-feed.service';

describe('OpportunityFeedService', () => {
  it('separates zero-entry persisted feeds from materialization_not_run', async () => {
    const opportunitiesRepository = {
      listMaterializedOpportunities: jest.fn().mockResolvedValue([]),
      findLatestOpportunityRescan: jest.fn().mockResolvedValue(null),
    };
    const scannerUniverseService = {
      getScannerUniverseMap: jest.fn().mockResolvedValue(new Map()),
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
});
