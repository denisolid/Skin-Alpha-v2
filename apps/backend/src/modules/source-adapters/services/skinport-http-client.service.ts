import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

import { AppConfigService } from '../../../infrastructure/config/app-config.service';
import type { SkinportItemSnapshotDto } from '../dto/skinport-item-snapshot.dto';
import type { SkinportSalesHistoryDto } from '../dto/skinport-sales-history.dto';

export class SkinportHttpError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
  }
}

@Injectable()
export class SkinportHttpClientService {
  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
  ) {}

  fetchItemsSnapshot(): Promise<SkinportItemSnapshotDto[]> {
    return this.requestJson<SkinportItemSnapshotDto[]>('items', {
      includeTradable: true,
    });
  }

  fetchSalesHistory(): Promise<SkinportSalesHistoryDto[]> {
    return this.requestJson<SkinportSalesHistoryDto[]>('sales/history');
  }

  private async requestJson<T>(
    path: string,
    input: {
      readonly includeTradable?: boolean;
    } = {},
  ): Promise<T> {
    const requestUrl = new URL(
      path.replace(/^\/+/, ''),
      `${this.configService.skinportApiBaseUrl.replace(/\/+$/, '')}/`,
    );

    requestUrl.searchParams.set(
      'app_id',
      String(this.configService.skinportAppId),
    );
    requestUrl.searchParams.set(
      'currency',
      this.configService.skinportCurrency,
    );

    if (input.includeTradable) {
      requestUrl.searchParams.set(
        'tradable',
        this.configService.skinportTradableOnly ? '1' : '0',
      );
    }

    // Skinport documents these endpoints as cached market snapshots and requires Brotli.
    const response = await fetch(requestUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'br',
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const responseBody = await response.text();

      if (response.status === 429) {
        throw new SkinportHttpError(
          `Skinport rate limit exceeded for ${path}: ${responseBody}`,
          response.status,
        );
      }

      throw new SkinportHttpError(
        `Skinport request failed for ${path}: ${responseBody}`,
        response.status,
      );
    }

    const payload = (await response.json()) as T;

    if (!payload) {
      throw new ServiceUnavailableException(
        `Skinport returned an empty payload for ${path}.`,
      );
    }

    return payload;
  }
}
