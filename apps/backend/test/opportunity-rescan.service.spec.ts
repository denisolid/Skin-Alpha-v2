import { OpportunityRescanService } from '../src/modules/opportunities/services/opportunity-rescan.service';

describe('OpportunityRescanService', () => {
  it('scans only variants that already exist in market state', async () => {
    const prismaService = {
      itemVariant: {
        findMany: jest.fn().mockResolvedValue([{ id: 'variant-1' }]),
      },
      source: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      opportunity: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn(),
      },
    };
    const opportunityEngineService = {
      evaluateVariants: jest.fn().mockResolvedValue({
        generatedAt: new Date('2026-04-14T00:00:00.000Z'),
        evaluatedItemCount: 1,
        evaluatedPairCount: 0,
        dispositionSummary: {
          candidate: 0,
          near_eligible: 0,
          eligible: 0,
          risky_high_upside: 0,
          rejected: 0,
        },
        antiFakeCounters: {
          rejectedByMismatch: 0,
          rejectedByPremiumContamination: 0,
          rejectedByMarketSanity: 0,
          warnedByMismatch: 0,
          warnedByPremiumContamination: 0,
          warnedByMarketSanity: 0,
        },
        diagnostics: {
          fetched: 0,
          normalized: 0,
          canonicalMatched: 0,
          pairable: 0,
          candidate: 0,
          eligible: 0,
          surfaced: 0,
        },
        results: [
          {
            generatedAt: new Date('2026-04-14T00:00:00.000Z'),
            category: 'CASE',
            canonicalItemId: 'canonical-1',
            canonicalDisplayName: 'Revolution Case',
            itemVariantId: 'variant-1',
            variantDisplayName: 'Default',
            evaluatedPairCount: 0,
            returnedPairCount: 0,
            dispositionSummary: {
              candidate: 0,
              near_eligible: 0,
              eligible: 0,
              risky_high_upside: 0,
              rejected: 0,
            },
            antiFakeCounters: {
              rejectedByMismatch: 0,
              rejectedByPremiumContamination: 0,
              rejectedByMarketSanity: 0,
              warnedByMismatch: 0,
              warnedByPremiumContamination: 0,
              warnedByMarketSanity: 0,
            },
            diagnostics: {
              fetched: 0,
              normalized: 0,
              canonicalMatched: 0,
              pairable: 0,
              candidate: 0,
              eligible: 0,
              surfaced: 0,
            },
            evaluations: [],
          },
        ],
      }),
    };
    const service = new OpportunityRescanService(
      prismaService as never,
      opportunityEngineService as never,
    );

    const result = await service.rescanAndPersist({ variantLimit: 10 });

    expect(prismaService.itemVariant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          marketStates: {
            some: {},
          },
        },
        take: 10,
      }),
    );
    expect(opportunityEngineService.evaluateVariants).toHaveBeenCalledWith(
      expect.objectContaining({
        itemVariantIds: ['variant-1'],
        includeRejected: true,
        maxPairs: 64,
        allowHistoricalFallback: false,
      }),
    );
    expect(result.scannedVariantCount).toBe(1);
  });
});
