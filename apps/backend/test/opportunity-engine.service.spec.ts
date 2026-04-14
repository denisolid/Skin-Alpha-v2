import { ItemCategory } from '@prisma/client';

import type {
  MergedMarketMatrixDto,
  MergedMarketMatrixRowDto,
  MergedMarketRowIdentityDto,
  MergedMarketVariantIdentityDto,
} from '../src/modules/market-state/dto/merged-market-matrix.dto';
import { OpportunityAntiFakeService } from '../src/modules/opportunities/services/opportunity-anti-fake.service';
import { OpportunityEnginePolicyService } from '../src/modules/opportunities/services/opportunity-engine-policy.service';
import { OpportunityEngineService } from '../src/modules/opportunities/services/opportunity-engine.service';

describe('OpportunityEngineService', () => {
  it('rejects cross-source price outliers before scoring them as opportunities', async () => {
    const matrix = createMatrix(ItemCategory.SKIN, {
      canonicalDisplayName: 'AK-47 | Slate',
      variantDisplayName: 'Factory New',
      variantIdentity: {
        exterior: 'Factory New',
        floatRelevant: false,
      },
      rows: [
        createRow('skinport', {
          ask: 100,
          bid: 99,
          listedQty: 7,
          identity: {
            title: 'AK-47 | Slate (Factory New)',
            condition: 'Factory New',
            isStatTrak: false,
            isSouvenir: false,
            hasSellerMetadata: true,
            hasScmHints: true,
          },
        }),
        createRow('csfloat', {
          ask: 172,
          bid: 170,
          listedQty: 6,
          identity: {
            title: 'AK-47 | Slate (Factory New)',
            condition: 'Factory New',
            isStatTrak: false,
            isSouvenir: false,
            hasSellerMetadata: true,
            hasScmHints: true,
          },
        }),
        createRow('bitskins', {
          ask: 112,
          bid: 111,
          listedQty: 6,
          identity: {
            title: 'AK-47 | Slate (Factory New)',
            condition: 'Factory New',
            isStatTrak: false,
            isSouvenir: false,
            hasSellerMetadata: true,
            hasScmHints: true,
          },
        }),
      ],
      conflict: {
        state: 'conflicted',
        comparedSourceCount: 3,
        usableSourceCount: 3,
        consensusAsk: 112,
        minAsk: 100,
        maxAsk: 172,
        spreadPercent: 64.2857,
      },
    });
    const service = createService(matrix);

    const result = await service.evaluateVariant(matrix.itemVariantId, {
      includeRejected: true,
      maxPairs: 8,
    });
    const evaluation = result.evaluations.find(
      (candidate) => candidate.sourcePairKey === 'skinport->csfloat',
    );

    expect(evaluation).toBeDefined();
    expect(evaluation?.disposition).toBe('rejected');
    expect(evaluation?.surfaceTier).toBe('rejected');
    expect(evaluation?.preScoreGate.passed).toBe(false);
    expect(evaluation?.reasonCodes).toEqual(
      expect.arrayContaining([
        'pre_score_outlier_rejected',
        'source_median_outlier_rejected',
        'cross_source_consensus_outlier_rejected',
      ]),
    );
  });

  it('demotes steam-snapshot supported pairs out of the tradable surface tier', async () => {
    const matrix = createMatrix(ItemCategory.CASE, {
      canonicalDisplayName: 'Dreams & Nightmares Case',
      variantDisplayName: 'Default',
      variantIdentity: {
        exterior: 'default',
        floatRelevant: false,
        patternRelevant: false,
      },
      rows: [
        createRow('skinport', {
          ask: 10.8,
          bid: 10.7,
          listedQty: 40,
          identity: {
            title: 'Dreams & Nightmares Case',
            condition: 'default',
            isStatTrak: false,
            isSouvenir: false,
            hasSellerMetadata: false,
            hasScmHints: false,
          },
        }),
        createRow('steam-snapshot', {
          ask: 15.2,
          bid: 15.1,
          listedQty: 44,
          fetchMode: 'snapshot',
          identity: {
            title: 'Dreams & Nightmares Case',
            condition: 'default',
            isStatTrak: false,
            isSouvenir: false,
            hasSellerMetadata: false,
            hasScmHints: false,
          },
        }),
        createRow('csfloat', {
          ask: 14.8,
          bid: 14.7,
          listedQty: 36,
          identity: {
            title: 'Dreams & Nightmares Case',
            condition: 'default',
            isStatTrak: false,
            isSouvenir: false,
            hasSellerMetadata: false,
            hasScmHints: false,
          },
        }),
      ],
      conflict: {
        state: 'aligned',
        comparedSourceCount: 3,
        usableSourceCount: 3,
        consensusAsk: 14.8,
        minAsk: 10.8,
        maxAsk: 15.2,
        spreadPercent: 29.7297,
      },
    });
    const service = createService(matrix);

    const result = await service.evaluateVariant(matrix.itemVariantId, {
      includeRejected: true,
      maxPairs: 8,
    });
    const evaluation = result.evaluations.find(
      (candidate) => candidate.sourcePairKey === 'skinport->steam-snapshot',
    );

    expect(evaluation).toBeDefined();
    expect(evaluation?.disposition).toBe('eligible');
    expect(evaluation?.surfaceTier).toBe('reference_backed');
    expect(evaluation?.eligibility.eligible).toBe(true);
    expect(evaluation?.eligibility.steamSnapshotDemoted).toBe(true);
    expect(evaluation?.eligibility.blockerReason).toBe('steam_snapshot_pair');
    expect(evaluation?.reasonCodes).toContain('steam_snapshot_pair_demoted');
  });

  it('does not reject default non-wear variants for missing strict identity keys', async () => {
    const matrix = createMatrix(ItemCategory.SKIN, {
      canonicalDisplayName: 'Sticker | kRYSTAL (Gold) | Krakow 2017',
      variantDisplayName: 'Default',
      variantIdentity: {
        marketHashName: 'Sticker | kRYSTAL (Gold) | Krakow 2017',
        floatRelevant: false,
      },
      rows: [
        createRow('skinport', {
          ask: 4200,
          bid: 4100,
          listedQty: 3,
          identity: {
            title: 'Sticker | kRYSTAL (Gold) | Krakow 2017',
            isStatTrak: false,
            isSouvenir: false,
            hasSellerMetadata: false,
            hasScmHints: false,
          },
        }),
        createRow('steam-snapshot', {
          ask: 4325,
          bid: 4275,
          listedQty: 2,
          fetchMode: 'snapshot',
          identity: {
            title: 'Sticker | kRYSTAL (Gold) | Krakow 2017',
            isStatTrak: false,
            isSouvenir: false,
            hasSellerMetadata: false,
            hasScmHints: false,
          },
        }),
        createRow('csfloat', {
          ask: 4280,
          bid: 4225,
          listedQty: 2,
          identity: {
            title: 'Sticker | kRYSTAL (Gold) | Krakow 2017',
            isStatTrak: false,
            isSouvenir: false,
            hasSellerMetadata: false,
            hasScmHints: false,
          },
        }),
      ],
      conflict: {
        state: 'aligned',
        comparedSourceCount: 3,
        usableSourceCount: 3,
        consensusAsk: 4280,
        minAsk: 4200,
        maxAsk: 4325,
        spreadPercent: 2.9762,
      },
    });
    const service = createService(matrix);

    const result = await service.evaluateVariant(matrix.itemVariantId, {
      includeRejected: true,
      maxPairs: 8,
    });
    const evaluation = result.evaluations.find(
      (candidate) => candidate.sourcePairKey === 'skinport->csfloat',
    );

    expect(evaluation).toBeDefined();
    expect(evaluation?.strictTradable.matched).toBe(true);
    expect(evaluation?.reasonCodes).not.toEqual(
      expect.arrayContaining([
        'strict_variant_key_missing',
        'strict_variant_key_mismatch',
      ]),
    );
  });

  it('does not count zero-quantity rows as usable market signal', async () => {
    const zeroSignalRow = createRow('csfloat', {
      ask: undefined,
      bid: undefined,
      listedQty: 0,
    });
    const matrix = createMatrix(ItemCategory.SKIN, {
      canonicalDisplayName: 'Paracord Knife | Fade',
      variantDisplayName: 'Factory New',
      variantIdentity: {
        exterior: 'Factory New',
        floatRelevant: true,
      },
      rows: [
        zeroSignalRow,
        createRow('skinport', {
          ask: 153.12,
          bid: undefined,
          listedQty: 51,
        }),
      ],
      conflict: {
        state: 'insufficient-data',
        comparedSourceCount: 1,
        usableSourceCount: 1,
      },
    });
    const service = createService(matrix);

    const result = await service.evaluateVariant(matrix.itemVariantId, {
      includeRejected: true,
      maxPairs: 8,
    });

    expect(result.diagnostics.normalized).toBe(1);
  });

  it('treats aggregate snapshot rows as compatible with precise rows when only float precision is missing', async () => {
    const matrix = createMatrix(ItemCategory.KNIFE, {
      canonicalDisplayName: 'Karambit | Doppler',
      variantDisplayName: 'Phase 2',
      variantIdentity: {
        exterior: 'Factory New',
        phaseLabel: 'Phase 2',
        isDoppler: true,
        floatRelevant: true,
      },
      rows: [
        createRow('skinport', {
          ask: 2400,
          bid: undefined,
          listedQty: 18,
          identity: {
            title: 'Karambit | Doppler (Phase 2)',
            condition: 'Factory New',
            isStatTrak: false,
            isSouvenir: false,
            hasSellerMetadata: false,
            hasScmHints: false,
          },
        }),
        createRow('csfloat', {
          ask: 2525,
          bid: 2500,
          listedQty: 1,
          identity: {
            title: 'Karambit | Doppler (Phase 2)',
            condition: 'Factory New',
            phase: 'Phase 2',
            wearFloat: 0.0261,
            isStatTrak: false,
            isSouvenir: false,
            hasSellerMetadata: true,
            hasScmHints: true,
          },
        }),
        createRow('steam-snapshot', {
          ask: 2540,
          bid: 2530,
          listedQty: 5,
          fetchMode: 'snapshot',
          identity: {
            title: 'Karambit | Doppler (Phase 2)',
            condition: 'Factory New',
            isStatTrak: false,
            isSouvenir: false,
            hasSellerMetadata: false,
            hasScmHints: false,
          },
        }),
      ],
      conflict: {
        state: 'aligned',
        comparedSourceCount: 3,
        usableSourceCount: 3,
        consensusAsk: 2525,
        minAsk: 2400,
        maxAsk: 2540,
        spreadPercent: 5.8333,
      },
    });
    const service = createService(matrix);

    const result = await service.evaluateVariant(matrix.itemVariantId, {
      includeRejected: true,
      maxPairs: 8,
    });
    const evaluation = result.evaluations.find(
      (candidate) => candidate.sourcePairKey === 'skinport->csfloat',
    );

    expect(evaluation).toBeDefined();
    expect(evaluation?.strictTradable.matched).toBe(true);
    expect(evaluation?.reasonCodes).not.toEqual(
      expect.arrayContaining(['strict_variant_key_mismatch']),
    );
  });

  it('treats snapshot rows without representative identity as aggregate references', async () => {
    const matrix = createMatrix(ItemCategory.SKIN, {
      canonicalDisplayName: 'AK-47 | Redline',
      variantDisplayName: 'Field-Tested',
      variantIdentity: {
        exterior: 'Field-Tested',
        floatRelevant: true,
      },
      rows: [
        createRow('csfloat', {
          ask: 31.2,
          bid: 30.8,
          listedQty: 2,
          identity: {
            title: 'AK-47 | Redline (Field-Tested)',
            condition: 'Field-Tested',
            wearFloat: 0.1974,
            paintSeed: 831,
            isStatTrak: false,
            isSouvenir: false,
            hasSellerMetadata: true,
            hasScmHints: false,
          },
        }),
        createRow('steam-snapshot', {
          ask: 47.67,
          bid: 47.3,
          listedQty: 103,
          fetchMode: 'snapshot',
          identity: null,
        }),
      ],
      conflict: {
        state: 'aligned',
        comparedSourceCount: 2,
        usableSourceCount: 2,
        consensusAsk: 39.43,
        minAsk: 31.2,
        maxAsk: 47.67,
        spreadPercent: 52.7885,
      },
    });
    const service = createService(matrix);

    const result = await service.evaluateVariant(matrix.itemVariantId, {
      includeRejected: true,
      maxPairs: 8,
    });
    const evaluation = result.evaluations.find(
      (candidate) => candidate.sourcePairKey === 'csfloat->steam-snapshot',
    );

    expect(evaluation).toBeDefined();
    expect(evaluation?.strictTradable.matched).toBe(true);
    expect(evaluation?.reasonCodes).not.toEqual(
      expect.arrayContaining(['strict_variant_key_mismatch']),
    );
  });

  it('treats single-listing snapshot rows without identity as aggregate references', async () => {
    const matrix = createMatrix(ItemCategory.SKIN, {
      canonicalDisplayName: 'M4A4 | Cyber Security',
      variantDisplayName: 'Factory New',
      variantIdentity: {
        exterior: 'Factory New',
        floatRelevant: true,
      },
      rows: [
        createRow('csfloat', {
          ask: 248.1,
          bid: 246.8,
          listedQty: 1,
          identity: {
            title: 'M4A4 | Cyber Security (Factory New)',
            condition: 'Factory New',
            wearFloat: 0.029,
            isStatTrak: false,
            isSouvenir: false,
            hasSellerMetadata: true,
            hasScmHints: false,
          },
        }),
        createRow('steam-snapshot', {
          ask: 261.2,
          bid: 260.4,
          listedQty: 1,
          fetchMode: 'snapshot',
          identity: null,
        }),
      ],
      conflict: {
        state: 'aligned',
        comparedSourceCount: 2,
        usableSourceCount: 2,
        consensusAsk: 254.65,
        minAsk: 248.1,
        maxAsk: 261.2,
        spreadPercent: 5.2801,
      },
    });
    const service = createService(matrix);

    const result = await service.evaluateVariant(matrix.itemVariantId, {
      includeRejected: true,
      maxPairs: 8,
    });
    const evaluation = result.evaluations.find(
      (candidate) => candidate.sourcePairKey === 'csfloat->steam-snapshot',
    );

    expect(evaluation).toBeDefined();
    expect(evaluation?.strictTradable.matched).toBe(true);
    expect(evaluation?.reasonCodes).not.toEqual(
      expect.arrayContaining(['strict_variant_key_mismatch']),
    );
  });

  it('treats snapshot rows with scm hints but no float or seed as aggregate references', async () => {
    const matrix = createMatrix(ItemCategory.SKIN, {
      canonicalDisplayName: 'M4A4 | Cyber Security',
      variantDisplayName: 'Factory New',
      variantIdentity: {
        exterior: 'Factory New',
        floatRelevant: true,
      },
      rows: [
        createRow('csfloat', {
          ask: 248.1,
          bid: 246.8,
          listedQty: 1,
          identity: {
            title: 'M4A4 | Cyber Security (Factory New)',
            condition: 'Factory New',
            wearFloat: 0.029,
            isStatTrak: false,
            isSouvenir: false,
            hasSellerMetadata: true,
            hasScmHints: false,
          },
        }),
        createRow('steam-snapshot', {
          ask: 261.2,
          bid: 260.4,
          listedQty: 8,
          fetchMode: 'snapshot',
          identity: {
            title: 'M4A4 | Cyber Security (Factory New)',
            condition: 'Factory New',
            isStatTrak: false,
            isSouvenir: false,
            hasSellerMetadata: false,
            hasScmHints: true,
          },
        }),
      ],
      conflict: {
        state: 'aligned',
        comparedSourceCount: 2,
        usableSourceCount: 2,
        consensusAsk: 254.65,
        minAsk: 248.1,
        maxAsk: 261.2,
        spreadPercent: 5.2801,
      },
    });
    const service = createService(matrix);

    const result = await service.evaluateVariant(matrix.itemVariantId, {
      includeRejected: true,
      maxPairs: 8,
    });
    const evaluation = result.evaluations.find(
      (candidate) => candidate.sourcePairKey === 'csfloat->steam-snapshot',
    );

    expect(evaluation).toBeDefined();
    expect(evaluation?.strictTradable.matched).toBe(true);
    expect(evaluation?.reasonCodes).not.toEqual(
      expect.arrayContaining(['strict_variant_key_mismatch']),
    );
  });

  it('treats aggregate live-source rows as compatible even when quantity collapses to one', async () => {
    const matrix = createMatrix(ItemCategory.SKIN, {
      canonicalDisplayName: 'FAMAS | ZX Spectron',
      variantDisplayName: 'Factory New',
      variantIdentity: {
        exterior: 'Factory New',
        floatRelevant: true,
      },
      rows: [
        createRow('csfloat', {
          ask: 19.8,
          bid: 19.2,
          listedQty: 1,
          identity: {
            title: 'FAMAS | ZX Spectron (Factory New)',
            condition: 'Factory New',
            wearFloat: 0.0072,
            paintSeed: 342,
            isStatTrak: false,
            isSouvenir: false,
            hasSellerMetadata: true,
            hasScmHints: false,
          },
        }),
        createRow('bitskins', {
          ask: 20.4,
          bid: undefined,
          listedQty: 1,
          identity: {
            title: 'FAMAS | ZX Spectron (Factory New)',
            condition: 'Factory New',
            isStatTrak: false,
            isSouvenir: false,
            hasSellerMetadata: false,
            hasScmHints: false,
          },
        }),
      ],
      conflict: {
        state: 'aligned',
        comparedSourceCount: 2,
        usableSourceCount: 2,
        consensusAsk: 20.1,
        minAsk: 19.8,
        maxAsk: 20.4,
        spreadPercent: 3.0303,
      },
    });
    const service = createService(matrix);

    const result = await service.evaluateVariant(matrix.itemVariantId, {
      includeRejected: true,
      maxPairs: 8,
    });
    const evaluation = result.evaluations.find(
      (candidate) => candidate.sourcePairKey === 'csfloat->bitskins',
    );

    expect(evaluation).toBeDefined();
    expect(evaluation?.strictTradable.matched).toBe(true);
    expect(evaluation?.reasonCodes).not.toEqual(
      expect.arrayContaining(['strict_variant_key_mismatch']),
    );
  });

  it('keeps listed-exit-only pairs as monitorable instead of hard rejecting them', async () => {
    const matrix = createMatrix(ItemCategory.CASE, {
      canonicalDisplayName: 'Revolution Case',
      variantDisplayName: 'Default',
      variantIdentity: {
        exterior: 'default',
        floatRelevant: false,
        patternRelevant: false,
      },
      rows: [
        createRow('skinport', {
          ask: 10,
          bid: 9.9,
          listedQty: 40,
        }),
        createRow('csfloat', {
          ask: 11,
          bid: undefined,
          listedQty: 40,
        }),
      ],
      conflict: {
        state: 'aligned',
        comparedSourceCount: 2,
        usableSourceCount: 2,
        consensusAsk: 10.5,
        minAsk: 10,
        maxAsk: 11,
        spreadPercent: 10,
      },
    });
    const service = createService(matrix);

    const result = await service.evaluateVariant(matrix.itemVariantId, {
      includeRejected: true,
      maxPairs: 8,
    });
    const evaluation = result.evaluations.find(
      (candidate) => candidate.sourcePairKey === 'skinport->csfloat',
    );

    expect(evaluation).toBeDefined();
    expect(evaluation?.disposition).not.toBe('rejected');
    expect(evaluation?.pairability.status).toBe('listed_exit_only');
    expect(evaluation?.reasonCodes).toContain('sell_source_requires_listed_exit');
  });

  it('hard rejects pairs with no executable exit signal', async () => {
    const matrix = createMatrix(ItemCategory.CASE, {
      canonicalDisplayName: 'Revolution Case',
      variantDisplayName: 'Default',
      variantIdentity: {
        exterior: 'default',
        floatRelevant: false,
        patternRelevant: false,
      },
      rows: [
        createRow('skinport', {
          ask: 10,
          bid: 9.9,
          listedQty: 40,
        }),
        createRow('csfloat', {
          ask: undefined,
          bid: undefined,
          listedQty: 0,
        }),
      ],
      conflict: {
        state: 'insufficient-data',
        comparedSourceCount: 1,
        usableSourceCount: 1,
      },
    });
    const service = createService(matrix);

    const result = await service.evaluateVariant(matrix.itemVariantId, {
      includeRejected: true,
      maxPairs: 8,
    });
    const evaluation = result.evaluations.find(
      (candidate) => candidate.sourcePairKey === 'skinport->csfloat',
    );

    expect(evaluation).toBeDefined();
    expect(evaluation?.disposition).toBe('rejected');
    expect(evaluation?.pairability.status).toBe('blocked');
    expect(evaluation?.reasonCodes).toContain('sell_source_has_no_exit_signal');
  });

  it('soft-classifies near-equal post-fee edges within epsilon', async () => {
    const matrix = createMatrix(ItemCategory.CASE, {
      canonicalDisplayName: 'Revolution Case',
      variantDisplayName: 'Default',
      variantIdentity: {
        exterior: 'default',
        floatRelevant: false,
        patternRelevant: false,
      },
      rows: [
        createRow('skinport', {
          ask: 10,
          bid: 9.9,
          listedQty: 40,
        }),
        createRow('csfloat', {
          ask: 10.2041,
          bid: 10.2041,
          listedQty: 40,
        }),
      ],
      conflict: {
        state: 'aligned',
        comparedSourceCount: 2,
        usableSourceCount: 2,
        consensusAsk: 10.102,
        minAsk: 10,
        maxAsk: 10.2041,
        spreadPercent: 2.041,
      },
    });
    const service = createService(matrix);

    const result = await service.evaluateVariant(matrix.itemVariantId, {
      includeRejected: true,
      maxPairs: 8,
    });
    const evaluation = result.evaluations.find(
      (candidate) => candidate.sourcePairKey === 'skinport->csfloat',
    );

    expect(evaluation).toBeDefined();
    expect(evaluation?.disposition).not.toBe('rejected');
    expect(evaluation?.reasonCodes).toContain('near_equal_after_fees');
    expect(evaluation?.reasonCodes).not.toContain('true_non_positive_edge');
  });

  it('still hard rejects true non-positive post-fee edges', async () => {
    const matrix = createMatrix(ItemCategory.CASE, {
      canonicalDisplayName: 'Revolution Case',
      variantDisplayName: 'Default',
      variantIdentity: {
        exterior: 'default',
        floatRelevant: false,
        patternRelevant: false,
      },
      rows: [
        createRow('skinport', {
          ask: 10,
          bid: 9.9,
          listedQty: 40,
        }),
        createRow('csfloat', {
          ask: 10.15,
          bid: 10.15,
          listedQty: 40,
        }),
      ],
      conflict: {
        state: 'aligned',
        comparedSourceCount: 2,
        usableSourceCount: 2,
        consensusAsk: 10.075,
        minAsk: 10,
        maxAsk: 10.15,
        spreadPercent: 1.5,
      },
    });
    const service = createService(matrix);

    const result = await service.evaluateVariant(matrix.itemVariantId, {
      includeRejected: true,
      maxPairs: 8,
    });
    const evaluation = result.evaluations.find(
      (candidate) => candidate.sourcePairKey === 'skinport->csfloat',
    );

    expect(evaluation).toBeDefined();
    expect(evaluation?.disposition).toBe('rejected');
    expect(evaluation?.reasonCodes).toEqual(
      expect.arrayContaining([
        'negative_fees_adjusted_spread',
        'true_non_positive_edge',
      ]),
    );
  });
});

function createService(matrix: MergedMarketMatrixDto): OpportunityEngineService {
  const mergeService = {
    getVariantMatrix: jest.fn().mockResolvedValue(matrix),
  };

  return new OpportunityEngineService(
    mergeService as never,
    new OpportunityEnginePolicyService(),
    new OpportunityAntiFakeService(),
  );
}

function createMatrix(
  category: ItemCategory,
  overrides: {
    readonly canonicalDisplayName?: string;
    readonly variantDisplayName?: string;
    readonly itemVariantId?: string;
    readonly variantIdentity?: Partial<MergedMarketVariantIdentityDto>;
    readonly rows?: readonly MergedMarketMatrixRowDto[];
    readonly conflict?: MergedMarketMatrixDto['conflict'];
  },
): MergedMarketMatrixDto {
  const {
    variantIdentity: variantIdentityOverrides,
    rows,
    conflict,
    ...restOverrides
  } = overrides;
  const variantIdentity: MergedMarketVariantIdentityDto = {
    marketHashName:
      variantIdentityOverrides?.marketHashName ?? 'AK-47 | Slate (Factory New)',
    ...(variantIdentityOverrides &&
    Object.prototype.hasOwnProperty.call(variantIdentityOverrides, 'exterior')
      ? variantIdentityOverrides.exterior
        ? { exterior: variantIdentityOverrides.exterior }
        : {}
      : { exterior: 'Factory New' }),
    ...(variantIdentityOverrides?.phaseLabel
      ? { phaseLabel: variantIdentityOverrides.phaseLabel }
      : {}),
    phaseFamily: variantIdentityOverrides?.phaseFamily ?? 'standard',
    phaseConfidence: variantIdentityOverrides?.phaseConfidence ?? 1,
    stattrak: variantIdentityOverrides?.stattrak ?? false,
    souvenir: variantIdentityOverrides?.souvenir ?? false,
    isVanilla: variantIdentityOverrides?.isVanilla ?? false,
    isDoppler: variantIdentityOverrides?.isDoppler ?? false,
    isGammaDoppler: variantIdentityOverrides?.isGammaDoppler ?? false,
    patternRelevant: variantIdentityOverrides?.patternRelevant ?? false,
    floatRelevant: variantIdentityOverrides?.floatRelevant ?? false,
    patternSensitivity:
      variantIdentityOverrides?.patternSensitivity ??
      (variantIdentityOverrides?.patternRelevant ? 'supported' : 'none'),
    floatSensitivity:
      variantIdentityOverrides?.floatSensitivity ??
      (variantIdentityOverrides?.floatRelevant ? 'supported' : 'none'),
    mappingConfidence: variantIdentityOverrides?.mappingConfidence ?? 0.94,
    ...(variantIdentityOverrides?.defIndex !== undefined
      ? { defIndex: variantIdentityOverrides.defIndex }
      : {}),
    ...(variantIdentityOverrides?.paintIndex !== undefined
      ? { paintIndex: variantIdentityOverrides.paintIndex }
      : {}),
  };

  return {
    generatedAt: new Date('2026-04-10T12:00:00.000Z'),
    canonicalItemId: '00000000-0000-4000-8000-000000000001',
    canonicalDisplayName: 'AK-47 | Slate',
    category,
    itemVariantId: '11111111-1111-4111-8111-111111111111',
    variantDisplayName: 'Factory New',
    variantIdentity,
    rows: rows ?? [],
    conflict: conflict ?? {
      state: 'aligned',
      comparedSourceCount: 0,
      usableSourceCount: 0,
    },
    ...restOverrides,
  };
}

function createRow(
  source: MergedMarketMatrixRowDto['source'],
  overrides: {
    readonly sourceName?: string;
    readonly ask?: number | undefined;
    readonly bid?: number | undefined;
    readonly listedQty?: number;
    readonly observedAt?: Date;
    readonly freshness?: MergedMarketMatrixRowDto['freshness'];
    readonly confidence?: number;
    readonly sourceConfidence?: number;
    readonly fetchMode?: MergedMarketMatrixRowDto['fetchMode'];
    readonly currency?: string;
    readonly identity?: Partial<MergedMarketRowIdentityDto> | null;
  } = {},
): MergedMarketMatrixRowDto {
  const identity =
    overrides.identity === null
      ? undefined
      : ({
          title: overrides.identity?.title ?? 'AK-47 | Slate (Factory New)',
          ...(overrides.identity &&
          Object.prototype.hasOwnProperty.call(overrides.identity, 'condition')
            ? overrides.identity.condition
              ? { condition: overrides.identity.condition }
              : {}
            : { condition: 'Factory New' }),
          ...(overrides.identity?.phase
            ? { phase: overrides.identity.phase }
            : {}),
          ...(overrides.identity?.paintSeed !== undefined
            ? { paintSeed: overrides.identity.paintSeed }
            : {}),
          ...(overrides.identity?.wearFloat !== undefined
            ? { wearFloat: overrides.identity.wearFloat }
            : {}),
          ...(overrides.identity &&
          Object.prototype.hasOwnProperty.call(overrides.identity, 'isStatTrak') &&
          overrides.identity.isStatTrak !== undefined
            ? { isStatTrak: overrides.identity.isStatTrak }
            : { isStatTrak: false }),
          ...(overrides.identity &&
          Object.prototype.hasOwnProperty.call(overrides.identity, 'isSouvenir') &&
          overrides.identity.isSouvenir !== undefined
            ? { isSouvenir: overrides.identity.isSouvenir }
            : { isSouvenir: false }),
          ...(overrides.identity?.stickerCount !== undefined
            ? { stickerCount: overrides.identity.stickerCount }
            : {}),
          hasSellerMetadata: overrides.identity?.hasSellerMetadata ?? false,
          hasScmHints: overrides.identity?.hasScmHints ?? false,
        } satisfies MergedMarketRowIdentityDto);

  return {
    source,
    sourceName: overrides.sourceName ?? source,
    ...(!Object.prototype.hasOwnProperty.call(overrides, 'ask')
      ? { ask: 120 }
      : overrides.ask !== undefined
        ? { ask: overrides.ask }
        : {}),
    ...(!Object.prototype.hasOwnProperty.call(overrides, 'bid')
      ? { bid: 119 }
      : overrides.bid !== undefined
        ? { bid: overrides.bid }
        : {}),
    listedQty: 5,
    observedAt: new Date('2026-04-10T12:00:00.000Z'),
    freshness: {
      state: 'fresh',
      lagMs: 60_000,
      staleAfterMs: 600_000,
      maxStaleMs: 7_200_000,
      usable: true,
    },
    confidence: 0.92,
    sourceConfidence: 0.92,
    fetchMode: source === 'steam-snapshot' ? 'snapshot' : 'live',
    currency: 'USD',
    ...(identity ? { identity } : {}),
    ...(overrides.listedQty !== undefined
      ? { listedQty: overrides.listedQty }
      : {}),
    ...(overrides.observedAt ? { observedAt: overrides.observedAt } : {}),
    ...(overrides.freshness ? { freshness: overrides.freshness } : {}),
    ...(overrides.confidence !== undefined
      ? { confidence: overrides.confidence }
      : {}),
    ...(overrides.sourceConfidence !== undefined
      ? { sourceConfidence: overrides.sourceConfidence }
      : {}),
    ...(overrides.fetchMode ? { fetchMode: overrides.fetchMode } : {}),
    ...(overrides.currency ? { currency: overrides.currency } : {}),
  };
}
