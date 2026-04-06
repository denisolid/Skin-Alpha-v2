import type { AppConfigService } from '../src/infrastructure/config/app-config.service';
import { SkinportHttpClientService } from '../src/modules/source-adapters/services/skinport-http-client.service';

function createConfigServiceMock(): AppConfigService {
  return {
    skinportApiBaseUrl: 'https://api.skinport.com/v1',
    skinportAppId: 730,
    skinportCurrency: 'EUR',
    skinportTradableOnly: true,
  } as AppConfigService;
}

function toRequestUrl(input: Parameters<typeof fetch>[0]): string {
  if (input instanceof URL) {
    return input.toString();
  }

  if (input instanceof Request) {
    return input.url;
  }

  return input;
}

describe('SkinportHttpClientService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('keeps the configured /v1 base path for the items snapshot endpoint', async () => {
    let capturedUrl: string | null = null;
    const fetchStub = (input: Parameters<typeof fetch>[0]) => {
      capturedUrl = toRequestUrl(input);

      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }),
      );
    };

    global.fetch = fetchStub as typeof fetch;

    const service = new SkinportHttpClientService(createConfigServiceMock());

    await service.fetchItemsSnapshot();

    expect(capturedUrl).not.toBeNull();
    if (!capturedUrl) {
      throw new Error('Expected items snapshot request URL to be captured.');
    }

    expect(capturedUrl).toContain('https://api.skinport.com/v1/items');
    expect(capturedUrl).toContain('app_id=730');
    expect(capturedUrl).toContain('currency=EUR');
    expect(capturedUrl).toContain('tradable=1');
  });

  it('does not append the tradable filter to sales history requests', async () => {
    let capturedUrl: string | null = null;
    const fetchStub = (input: Parameters<typeof fetch>[0]) => {
      capturedUrl = toRequestUrl(input);

      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }),
      );
    };

    global.fetch = fetchStub as typeof fetch;

    const service = new SkinportHttpClientService(createConfigServiceMock());

    await service.fetchSalesHistory();

    expect(capturedUrl).not.toBeNull();
    if (!capturedUrl) {
      throw new Error('Expected sales history request URL to be captured.');
    }

    expect(capturedUrl).toContain('https://api.skinport.com/v1/sales/history');
    expect(capturedUrl).toContain('app_id=730');
    expect(capturedUrl).toContain('currency=EUR');
    expect(capturedUrl).not.toContain('tradable=');
  });
});
