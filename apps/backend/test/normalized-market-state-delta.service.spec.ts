import { NormalizedMarketStateDeltaService } from '../src/modules/source-adapters/services/normalized-market-state-delta.service';

describe('NormalizedMarketStateDeltaService', () => {
  it('filters unchanged Skinport item-snapshot market states before downstream persistence', async () => {
    const logger = {
      log: jest.fn(),
    };
    const prismaService = {
      sourceMarketFact: {
        findMany: jest.fn().mockResolvedValue([
          {
            itemVariantId: 'variant-1',
            canonicalItemId: 'canonical-1',
            currencyCode: 'USD',
            lowestAskGross: { toString: () => '12.34' },
            highestBidGross: null,
            medianAskGross: { toString: () => '13.11' },
            lastTradeGross: null,
            average24hGross: null,
            listingCount: 5,
            saleCount24h: null,
            sampleSize: null,
            confidence: { toString: () => '0.6949' },
            liquidityScore: { toString: () => '0.3891' },
          },
        ]),
      },
      marketState: {
        findMany: jest.fn().mockResolvedValue([
          {
            itemVariantId: 'variant-1',
          },
        ]),
      },
    };
    const sourceRecordService = {
      resolveByKey: jest.fn().mockResolvedValue({
        id: 'source-1',
      }),
    };
    const service = new NormalizedMarketStateDeltaService(
      logger as never,
      prismaService as never,
      sourceRecordService as never,
    );

    const result = await service.applyChangedOnlyGate({
      rawPayloadArchiveId: 'archive-1',
      source: 'skinport',
      endpointName: 'skinport-items-snapshot',
      observedAt: new Date('2026-04-12T10:00:00.000Z'),
      payloadHash: 'hash-1',
      listings: [],
      marketStates: [
        {
          source: 'skinport',
          canonicalItemId: 'canonical-1',
          itemVariantId: 'variant-1',
          capturedAt: new Date('2026-04-12T10:00:00.000Z'),
          currency: 'USD',
          lowestAskMinor: 1234,
          medianAskMinor: 1311,
          listingCount: 5,
          confidence: 0.6949,
          liquidityScore: 0.3891,
        },
        {
          source: 'skinport',
          canonicalItemId: 'canonical-2',
          itemVariantId: 'variant-2',
          capturedAt: new Date('2026-04-12T10:00:00.000Z'),
          currency: 'USD',
          lowestAskMinor: 2500,
          medianAskMinor: 2600,
          listingCount: 2,
          confidence: 0.62,
          liquidityScore: 0.23,
        },
      ],
      warnings: [],
    });

    expect(result.changedMarketStateCount).toBe(1);
    expect(result.unchangedMarketStateCount).toBe(1);
    expect(result.payload.marketStates).toHaveLength(1);
    expect(result.payload.marketStates[0]?.itemVariantId).toBe('variant-2');
    expect(result.unchangedMarketStates[0]?.itemVariantId).toBe('variant-1');
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('changed=1 unchanged=1'),
      NormalizedMarketStateDeltaService.name,
    );
  });
});
