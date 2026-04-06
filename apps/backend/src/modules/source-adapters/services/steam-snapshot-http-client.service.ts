import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

import { AppConfigService } from '../../../infrastructure/config/app-config.service';
import type { SteamPriceOverviewDto } from '../dto/steam-snapshot.dto';
import { SteamSnapshotRateLimitService } from './steam-snapshot-rate-limit.service';

export class SteamSnapshotHttpError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

@Injectable()
export class SteamSnapshotHttpClientService {
  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
    @Inject(SteamSnapshotRateLimitService)
    private readonly steamSnapshotRateLimitService: SteamSnapshotRateLimitService,
  ) {}

  async fetchPriceOverview(
    marketHashName: string,
  ): Promise<SteamPriceOverviewDto> {
    const requestUrl = new URL(
      'priceoverview/',
      `${this.configService.steamSnapshotApiBaseUrl.replace(/\/+$/, '')}/`,
    );

    requestUrl.searchParams.set(
      'appid',
      String(this.configService.steamSnapshotAppId),
    );
    requestUrl.searchParams.set(
      'currency',
      String(this.configService.steamSnapshotCurrencyCode),
    );
    requestUrl.searchParams.set(
      'country',
      this.configService.steamSnapshotCountry,
    );
    requestUrl.searchParams.set(
      'language',
      this.configService.steamSnapshotLanguage,
    );
    requestUrl.searchParams.set('market_hash_name', marketHashName);

    // Public Steam Community Market snapshot endpoint. No privileged Steam API
    // assumptions or account-bound market access are used here.
    const response = await fetch(requestUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(20_000),
    });

    if (response.status === 429) {
      const retryAfterSeconds = this.readRetryAfter(response.headers);

      await this.steamSnapshotRateLimitService.markRateLimited(
        retryAfterSeconds,
      );

      throw new SteamSnapshotHttpError(
        `Steam snapshot rate limit exceeded for ${marketHashName}.`,
        response.status,
        retryAfterSeconds,
      );
    }

    if (!response.ok) {
      const responseBody = await response.text();

      throw new SteamSnapshotHttpError(
        `Steam snapshot request failed for ${marketHashName}: ${responseBody}`,
        response.status,
      );
    }

    const payload = (await response.json()) as Partial<SteamPriceOverviewDto>;

    if (typeof payload.success !== 'boolean') {
      throw new ServiceUnavailableException(
        `Steam snapshot response was invalid for ${marketHashName}.`,
      );
    }

    return {
      success: payload.success,
      ...(typeof payload.lowest_price === 'string'
        ? { lowest_price: payload.lowest_price }
        : {}),
      ...(typeof payload.median_price === 'string'
        ? { median_price: payload.median_price }
        : {}),
      ...(typeof payload.volume === 'string' ? { volume: payload.volume } : {}),
    };
  }

  private readRetryAfter(headers: Headers): number | undefined {
    const rawValue = headers.get('retry-after');

    if (!rawValue) {
      return undefined;
    }

    const parsedValue = Number(rawValue);

    return Number.isNaN(parsedValue) ? undefined : parsedValue;
  }
}
