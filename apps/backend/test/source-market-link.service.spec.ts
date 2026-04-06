import { SourceMarketLinkService } from '../src/modules/market-state/services/source-market-link.service';

describe('SourceMarketLinkService', () => {
  const service = new SourceMarketLinkService({
    warn: jest.fn(),
  } as never);

  it('passes through persisted Skinport market links', () => {
    const links = service.resolveLinks({
      sourceCode: 'skinport',
      canonicalDisplayName: 'AK-47 | Redline',
      variantDisplayName: 'Field-Tested',
      variantMetadata: null,
      representativeListing: {
        externalListingId: 'skinport:items:ak-redline-ft',
        title: 'AK-47 | Redline (Field-Tested)',
        listingUrl: 'https://skinport.com/item/ak-redline-ft',
      },
    });

    expect(links).toEqual({
      marketUrl: 'https://skinport.com/item/ak-redline-ft',
      listingUrl: 'https://skinport.com/item/ak-redline-ft',
    });
  });

  it('builds Steam market URLs from catalog metadata', () => {
    const links = service.resolveLinks({
      sourceCode: 'steam-snapshot',
      canonicalDisplayName: 'AK-47 | Redline',
      variantDisplayName: 'Field-Tested',
      variantMetadata: {
        marketHashName: 'AK-47 | Redline (Field-Tested)',
      },
    });

    expect(links.marketUrl).toBe(
      'https://steamcommunity.com/market/listings/730/AK-47%20%7C%20Redline%20(Field-Tested)',
    );
  });

  it('builds a CSFloat direct listing fallback when no public listing URL is stored', () => {
    const links = service.resolveLinks({
      sourceCode: 'csfloat',
      canonicalDisplayName: 'AK-47 | Redline',
      variantDisplayName: 'Field-Tested',
      variantMetadata: null,
      representativeListing: {
        externalListingId: '123456789',
        title: 'AK-47 | Redline (Field-Tested)',
      },
    });

    expect(links).toEqual({
      marketUrl: 'https://csfloat.com/item/123456789',
      listingUrl: 'https://csfloat.com/item/123456789',
    });
  });
});
