import { ItemCategory } from '@prisma/client';

import type { OpportunitiesRepository } from '../src/modules/opportunities/domain/opportunities.repository';
import type { ScannerUniverseCandidateRecord } from '../src/modules/opportunities/domain/opportunities.repository';
import type { ScannerUniverseItemDto } from '../src/modules/opportunities/dto/scanner-universe.dto';
import type { ScannerUniverseAdminOverrideService } from '../src/modules/opportunities/services/scanner-universe-admin-override.service';
import type { ScannerUniversePolicyService } from '../src/modules/opportunities/services/scanner-universe-policy.service';
import { ScannerUniverseService } from '../src/modules/opportunities/services/scanner-universe.service';

describe('ScannerUniverseService', () => {
  it('prioritizes multi-source overlap items ahead of single-source items', async () => {
    const candidates = [
      {
        canonicalItemId: 'canonical-single',
        canonicalDisplayName: 'Single Source Item',
        category: ItemCategory.SKIN,
        itemType: 'rifle',
        itemVariantId: 'variant-single',
        variantDisplayName: 'Factory New',
        marketStates: [],
        opportunities: [],
      },
      {
        canonicalItemId: 'canonical-overlap',
        canonicalDisplayName: 'Overlap Item',
        category: ItemCategory.SKIN,
        itemType: 'rifle',
        itemVariantId: 'variant-overlap',
        variantDisplayName: 'Minimal Wear',
        marketStates: [],
        opportunities: [],
      },
    ] as const;
    const repository: OpportunitiesRepository = {
      findScannerUniverseCandidates: jest.fn().mockResolvedValue(candidates),
      findScannerUniverseVariant: jest.fn().mockResolvedValue(candidates[0]),
    };
    const adminOverrideService = {
      listHotOverrides: jest.fn().mockResolvedValue(new Map()),
      getHotOverride: jest.fn().mockResolvedValue(null),
      setHotOverride: jest.fn(),
      clearHotOverride: jest.fn(),
    } as unknown as ScannerUniverseAdminOverrideService;
    const singleSourceItem: ScannerUniverseItemDto = {
      canonicalItemId: 'canonical-single',
      canonicalDisplayName: 'Single Source Item',
      itemVariantId: 'variant-single',
      variantDisplayName: 'Factory New',
      category: ItemCategory.SKIN,
      itemType: 'rifle',
      tier: 'hot',
      compositeScore: 0.99,
      signals: {
        liquidity: 0.99,
        priceMovement: 0.9,
        sourceActivity: 0.4,
        opportunityFrequency: 0,
        composite: 0.99,
      },
      opportunityMetrics: {
        openCount: 0,
        recent7dCount: 0,
        recent30dCount: 0,
      },
      sourceMetrics: {
        totalSourceCount: 1,
        usableSourceCount: 1,
        freshSourceCount: 1,
        backupSourceCount: 0,
      },
      pollingPlan: [],
      promotionReasons: [],
      demotionReasons: [],
    };
    const overlapItem: ScannerUniverseItemDto = {
      canonicalItemId: 'canonical-overlap',
      canonicalDisplayName: 'Overlap Item',
      itemVariantId: 'variant-overlap',
      variantDisplayName: 'Minimal Wear',
      category: ItemCategory.SKIN,
      itemType: 'rifle',
      tier: 'cold',
      compositeScore: 0.2,
      signals: {
        liquidity: 0.2,
        priceMovement: 0.2,
        sourceActivity: 1,
        opportunityFrequency: 0,
        composite: 0.2,
      },
      opportunityMetrics: {
        openCount: 0,
        recent7dCount: 0,
        recent30dCount: 0,
      },
      sourceMetrics: {
        totalSourceCount: 2,
        usableSourceCount: 2,
        freshSourceCount: 0,
        backupSourceCount: 0,
      },
      pollingPlan: [],
      promotionReasons: [],
      demotionReasons: [],
    };
    const policyService = {
      evaluateCandidate: jest.fn((candidate: ScannerUniverseCandidateRecord) =>
        candidate.itemVariantId === 'variant-overlap'
          ? overlapItem
          : singleSourceItem,
      ),
    } as unknown as ScannerUniversePolicyService;
    const service = new ScannerUniverseService(
      repository,
      adminOverrideService,
      policyService,
    );

    const result = await service.getScannerUniverse({
      limit: 2,
    });

    expect(result.items.map((item) => item.itemVariantId)).toEqual([
      'variant-overlap',
      'variant-single',
    ]);
  });
});
