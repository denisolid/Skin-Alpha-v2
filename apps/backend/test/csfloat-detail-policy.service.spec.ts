import { CsFloatDetailPolicyService } from '../src/modules/source-adapters/services/csfloat-detail-policy.service';

describe('CsFloatDetailPolicyService', () => {
  const service = new CsFloatDetailPolicyService();

  it('requests listing detail when float metadata is missing', () => {
    expect(
      service.determineReason({
        id: 'listing-1',
        price: 1250,
        item: {
          assetId: 'asset-1',
          marketHashName: 'AK-47 | Slate (Factory New)',
        },
      }),
    ).toBe('missing-float');
  });

  it('requests listing detail when seed metadata is missing after float exists', () => {
    expect(
      service.determineReason({
        id: 'listing-2',
        price: 1750,
        item: {
          assetId: 'asset-2',
          marketHashName: 'AK-47 | Case Hardened (Field-Tested)',
          floatValue: 0.221,
        },
      }),
    ).toBe('missing-seed');
  });

  it('skips sticker-only detail fetches because they do not improve state coverage', () => {
    expect(
      service.determineReason({
        id: 'listing-3',
        price: 2250,
        item: {
          assetId: 'asset-3',
          marketHashName: 'AWP | Sun in Leo (Factory New)',
          floatValue: 0.02724,
          paintSeed: 255,
        },
      }),
    ).toBeNull();
  });
});
