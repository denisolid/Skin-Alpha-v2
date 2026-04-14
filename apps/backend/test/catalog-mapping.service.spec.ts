import { ItemCategory } from '@prisma/client';

import { CatalogMappingService } from '../src/modules/catalog/services/catalog-mapping.service';
import { CatalogAliasNormalizationService } from '../src/modules/catalog/services/catalog-alias-normalization.service';
import { CatalogPhaseNormalizationService } from '../src/modules/catalog/services/catalog-phase-normalization.service';
import { VariantSignalPolicyService } from '../src/modules/catalog/services/variant-signal-policy.service';

describe('CatalogMappingService', () => {
  const aliasNormalizationService = new CatalogAliasNormalizationService();
  const service = new CatalogMappingService(
    aliasNormalizationService,
    new CatalogPhaseNormalizationService(aliasNormalizationService),
    new VariantSignalPolicyService(),
  );

  it('does not double-count Doppler phases as both exterior and phase', () => {
    const mapping = service.mapSourceListing({
      source: 'skinport',
      marketHashName: 'Butterfly Knife | Doppler (Phase 2)',
      type: 'knife',
      weapon: 'Butterfly Knife',
      skinName: 'Doppler',
      rarity: 'Covert',
      defIndex: 515,
      paintIndex: 420,
      phaseHint: 'Phase 2',
    });

    expect(mapping.exterior).toBeUndefined();
    expect(mapping.phaseLabel).toBe('Phase 2');
    expect(mapping.variantKey).toBe('phase-2');
    expect(mapping.variantDisplayName).toBe('Phase 2');
  });

  it('does not mark default non-wear variants as float relevant', () => {
    const mapping = service.mapSourceListing({
      source: 'skinport',
      marketHashName: 'Sticker | kRYSTAL (Gold) | Krakow 2017',
    });

    expect(mapping.category).toBe(ItemCategory.SKIN);
    expect(mapping.variantDisplayName).toBe('Default');
    expect(mapping.exterior).toBeUndefined();
    expect(mapping.floatRelevant).toBe(false);
  });

  it('does not misclassify non-doppler emerald finishes as phase variants', () => {
    const mapping = service.mapSourceListing({
      source: 'csfloat',
      marketHashName: 'AUG | Emerald Jormungandr (Factory New)',
      exterior: 'Factory New',
      defIndex: 8,
      paintIndex: 759,
    });

    expect(mapping.phaseLabel).toBeUndefined();
    expect(mapping.exterior).toBe('Factory New');
    expect(mapping.variantKey).toBe('factory-new');
  });

  it('normalizes star-prefixed stattrak knife titles safely', () => {
    const mapping = service.mapSourceListing({
      source: 'waxpeer',
      marketHashName: '★ StatTrak™ Karambit | Doppler (P2)',
      phaseHint: 'P2',
    });

    expect(mapping.category).toBe(ItemCategory.KNIFE);
    expect(mapping.weapon).toBe('Karambit');
    expect(mapping.skinName).toBe('Doppler');
    expect(mapping.stattrak).toBe(true);
    expect(mapping.phaseLabel).toBe('Phase 2');
    expect(mapping.variantKey).toBe('phase-2:stattrak');
  });
  it('does not classify case-hardened knives as cases', () => {
    const mapping = service.mapSourceListing({
      source: 'csfloat',
      marketHashName: '★ M9 Bayonet | Case Hardened (Well-Worn)',
    });

    expect(mapping.category).toBe(ItemCategory.KNIFE);
    expect(mapping.weapon).toBe('M9 Bayonet');
    expect(mapping.skinName).toBe('Case Hardened');
    expect(mapping.exterior).toBe('Well-Worn');
    expect(mapping.patternRelevant).toBe(true);
  });
});
