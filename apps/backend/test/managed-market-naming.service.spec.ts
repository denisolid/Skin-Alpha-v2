import { ItemCategory } from '@prisma/client';

import { ManagedMarketNamingService } from '../src/modules/source-adapters/services/managed-market-naming.service';

describe('ManagedMarketNamingService', () => {
  const service = new ManagedMarketNamingService();

  it('adds star prefix and phase label for knife variants without source titles', () => {
    const marketHashName = service.buildMarketHashName({
      category: ItemCategory.KNIFE,
      canonicalDisplayName: 'Karambit | Doppler',
      variantDisplayName: 'Phase 2',
      variantKey: 'phase-2',
      variantMetadata: {
        mapping: {
          phaseLabel: 'Phase 2',
        },
      },
    });

    expect(marketHashName).toBe('★ Karambit | Doppler (Phase 2)');
  });

  it('inserts stattrak after the star prefix for knife titles', () => {
    const marketHashName = service.buildMarketHashName({
      category: ItemCategory.KNIFE,
      canonicalDisplayName: 'Karambit | Doppler',
      variantDisplayName: 'Phase 2 / StatTrak',
      variantKey: 'phase-2:stattrak',
      variantMetadata: {
        mapping: {
          phaseLabel: 'Phase 2',
        },
      },
    });

    expect(marketHashName).toBe('★ StatTrak™ Karambit | Doppler (Phase 2)');
  });
});
