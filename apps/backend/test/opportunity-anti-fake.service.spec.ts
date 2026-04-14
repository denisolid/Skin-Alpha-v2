import { ItemCategory } from '@prisma/client';

import type {
  MergedMarketMatrixDto,
  MergedMarketMatrixRowDto,
} from '../src/modules/market-state/dto/merged-market-matrix.dto';
import { OpportunityAntiFakeService } from '../src/modules/opportunities/services/opportunity-anti-fake.service';

describe('OpportunityAntiFakeService', () => {
  const service = new OpportunityAntiFakeService();

  it('hard rejects explicit exterior mismatches for skins', () => {
    const matrix = createMatrix(ItemCategory.SKIN, {
      exterior: 'Field-Tested',
      mappingConfidence: 0.86,
    });
    const buyRow = createRow('skinport', {
      ask: 118,
      listedQty: 5,
      identity: {
        title: 'AK-47 | Redline (Minimal Wear)',
        condition: 'Minimal Wear',
        isStatTrak: false,
        isSouvenir: false,
      },
    });
    const sellRow = createRow('csfloat', {
      ask: 128,
      listedQty: 3,
      identity: {
        title: 'AK-47 | Redline (Field-Tested)',
        condition: 'Field-Tested',
        isStatTrak: false,
        isSouvenir: false,
      },
    });

    const assessment = service.assess({
      matrix: {
        ...matrix,
        rows: [buyRow, sellRow],
      },
      buyRow,
      sellRow,
      backupRows: [],
      buyCost: 118,
      sellSignalPrice: 128,
    });

    expect(assessment.hardReject).toBe(true);
    expect(assessment.reasonCodes).toContain('MISMATCH_EXTERIOR');
  });

  it('adds premium contamination risk for float and sticker asymmetry', () => {
    const matrix = createMatrix(ItemCategory.SKIN, {
      marketHashName: 'AK-47 | Case Hardened (Field-Tested)',
      mappingConfidence: 0.8,
      floatRelevant: true,
      patternRelevant: true,
    });
    const buyRow = createRow('csfloat', {
      ask: 127.5,
      listedQty: 1,
      identity: {
        title: 'AK-47 | Case Hardened (Field-Tested)',
        condition: 'Field-Tested',
        paintSeed: 387,
        wearFloat: 0.18,
        stickerCount: 4,
        isStatTrak: false,
        isSouvenir: false,
      },
    });
    const sellRow = createRow('skinport', {
      ask: 154,
      listedQty: 2,
      identity: {
        title: 'AK-47 | Case Hardened (Field-Tested)',
        condition: 'Field-Tested',
        isStatTrak: false,
        isSouvenir: false,
      },
    });

    const assessment = service.assess({
      matrix: {
        ...matrix,
        rows: [buyRow, sellRow],
      },
      buyRow,
      sellRow,
      backupRows: [],
      buyCost: 127.5,
      sellSignalPrice: 154,
    });

    expect(assessment.hardReject).toBe(false);
    expect(assessment.premiumContaminationRisk).toBeGreaterThan(0);
    expect(assessment.reasonCodes).toEqual(
      expect.arrayContaining([
        'UNKNOWN_FLOAT_PREMIUM',
        'UNKNOWN_PATTERN_PREMIUM',
        'UNKNOWN_STICKER_PREMIUM',
        'NO_CONFIRMING_SOURCE',
      ]),
    );
  });

  it('tracks anti-fake diagnostic counters from rejected and downgraded items', () => {
    const counters = service.createCounters([
      {
        disposition: 'rejected',
        reasonCodes: ['MISMATCH_PHASE'],
        antiFakeAssessment: {
          hardReject: true,
          riskScore: 1,
          matchConfidence: 0.1,
          premiumContaminationRisk: 0,
          marketSanityRisk: 0.2,
          confirmationScore: 0,
          reasonCodes: ['MISMATCH_PHASE'],
        },
      },
      {
        disposition: 'rejected',
        reasonCodes: ['UNKNOWN_FLOAT_PREMIUM'],
        antiFakeAssessment: {
          hardReject: false,
          riskScore: 0.7,
          matchConfidence: 0.7,
          premiumContaminationRisk: 0.6,
          marketSanityRisk: 0.2,
          confirmationScore: 0,
          reasonCodes: ['UNKNOWN_FLOAT_PREMIUM'],
        },
      },
      {
        disposition: 'risky_high_upside',
        reasonCodes: ['UNKNOWN_PHASE_PREMIUM'],
        antiFakeAssessment: {
          hardReject: false,
          riskScore: 0.52,
          matchConfidence: 0.72,
          premiumContaminationRisk: 0.42,
          marketSanityRisk: 0.18,
          confirmationScore: 0,
          reasonCodes: ['UNKNOWN_PHASE_PREMIUM'],
        },
      },
    ]);

    expect(counters.rejectedByMismatch).toBe(1);
    expect(counters.rejectedByPremiumContamination).toBe(1);
    expect(counters.downgradedToRiskyHighUpside).toBe(1);
  });

  it('does not treat non-doppler emerald skin names as phase mismatches', () => {
    const matrix = createMatrix(ItemCategory.SKIN, {
      marketHashName: 'AUG | Emerald Jormungandr (Factory New)',
      exterior: 'Factory New',
      mappingConfidence: 0.91,
    });
    const buyRow = createRow('skinport', {
      ask: 420,
      listedQty: 4,
      identity: {
        title: 'AUG | Emerald Jormungandr (Factory New)',
        condition: 'Factory New',
        isStatTrak: false,
        isSouvenir: false,
      },
    });
    const sellRow = createRow('waxpeer', {
      ask: 455,
      listedQty: 2,
      identity: {
        title: 'AUG | Emerald Jormungandr (Factory New)',
        condition: 'Factory New',
        isStatTrak: false,
        isSouvenir: false,
      },
    });

    const assessment = service.assess({
      matrix: {
        ...matrix,
        rows: [buyRow, sellRow],
      },
      buyRow,
      sellRow,
      backupRows: [],
      buyCost: 420,
      sellSignalPrice: 455,
    });

    expect(assessment.reasonCodes).not.toContain('MISMATCH_PHASE');
  });
});

function createMatrix(
  category: ItemCategory,
  overrides: Partial<MergedMarketMatrixDto['variantIdentity']> = {},
): MergedMarketMatrixDto {
  return {
    generatedAt: new Date('2026-04-06T12:00:00.000Z'),
    canonicalItemId: 'canonical-item-1',
    canonicalDisplayName: 'AK-47 | Redline',
    category,
    itemVariantId: 'item-variant-1',
    variantDisplayName: 'Field-Tested',
    variantIdentity: {
      marketHashName: 'AK-47 | Redline (Field-Tested)',
      exterior: category === ItemCategory.SKIN ? 'Field-Tested' : undefined,
      phaseLabel: undefined,
      stattrak: false,
      souvenir: false,
      isVanilla: false,
      patternRelevant: false,
      floatRelevant:
        category !== ItemCategory.CASE && category !== ItemCategory.CAPSULE,
      mappingConfidence: 0.72,
      ...overrides,
    },
    rows: [],
    conflict: {
      state: 'divergent',
      comparedSourceCount: 2,
      usableSourceCount: 2,
      consensusAsk: 140,
      minAsk: 127.5,
      maxAsk: 154,
      spreadPercent: 20.7843,
    },
  };
}

function createRow(
  source: MergedMarketMatrixRowDto['source'],
  overrides: Partial<MergedMarketMatrixRowDto> = {},
): MergedMarketMatrixRowDto {
  return {
    source,
    sourceName: source,
    ask: 120,
    listedQty: 3,
    observedAt: new Date('2026-04-06T12:00:00.000Z'),
    freshness: {
      state: 'fresh',
      lagMs: 60_000,
      staleAfterMs: 600_000,
      maxStaleMs: 7_200_000,
      usable: true,
    },
    confidence: 0.74,
    sourceConfidence: 0.74,
    fetchMode: source === 'steam-snapshot' ? 'snapshot' : 'live',
    currency: 'USD',
    ...overrides,
  };
}
