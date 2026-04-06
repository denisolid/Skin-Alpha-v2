import { CsFloatMarketStateService } from '../src/modules/source-adapters/services/csfloat-market-state.service';

describe('CsFloatMarketStateService', () => {
  it('gives sparse but real listing states a meaningful confidence floor', () => {
    const service = new CsFloatMarketStateService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const singleListingConfidence = (
      service as unknown as {
        deriveConfidence(volume: number): number;
      }
    ).deriveConfidence(1);
    const deeperBookConfidence = (
      service as unknown as {
        deriveConfidence(volume: number): number;
      }
    ).deriveConfidence(10);

    expect(singleListingConfidence).toBeGreaterThanOrEqual(0.5);
    expect(deeperBookConfidence).toBeGreaterThan(singleListingConfidence);
  });
});
