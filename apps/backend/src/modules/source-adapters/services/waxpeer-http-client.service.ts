import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

import { AppConfigService } from '../../../infrastructure/config/app-config.service';
import { WAXPEER_MAX_NAMES_PER_REQUEST } from '../domain/waxpeer.constants';
import type {
  WaxpeerMassInfoBucketDto,
  WaxpeerMassInfoListingDto,
  WaxpeerMassInfoResponseDto,
} from '../dto/waxpeer-market-item.dto';
import { WaxpeerRateLimitService } from './waxpeer-rate-limit.service';

export class WaxpeerHttpError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

@Injectable()
export class WaxpeerHttpClientService {
  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
    @Inject(WaxpeerRateLimitService)
    private readonly waxpeerRateLimitService: WaxpeerRateLimitService,
  ) {}

  async fetchMassInfo(input: {
    readonly names: readonly string[];
  }): Promise<WaxpeerMassInfoResponseDto> {
    this.assertConfigured();

    const names = [...new Set(input.names.map((name) => name.trim()))]
      .filter((name) => name.length > 0)
      .slice(0, WAXPEER_MAX_NAMES_PER_REQUEST);

    if (names.length === 0) {
      return {
        success: true,
        data: {},
      };
    }

    const requestUrl = new URL(
      'v1/mass-info',
      `${this.configService.waxpeerApiBaseUrl.replace(/\/+$/, '')}/`,
    );

    requestUrl.searchParams.set('api', this.configService.waxpeerApiKey!);
    requestUrl.searchParams.set('game', this.configService.waxpeerGame);

    const response = await this.request(requestUrl, {
      name: names,
      sell: 1,
    });
    const payload = await response.json();
    const envelope = this.unwrapPayload(payload);
    const rateLimit = await this.waxpeerRateLimitService.recordResponse(
      response.headers,
    );

    return {
      ...envelope,
      rateLimit: {
        endpoint: 'mass-info',
        ...(rateLimit.limit !== undefined ? { limit: rateLimit.limit } : {}),
        ...(rateLimit.remaining !== undefined
          ? { remaining: rateLimit.remaining }
          : {}),
        ...(rateLimit.resetAt
          ? { resetAt: rateLimit.resetAt.toISOString() }
          : {}),
        ...(rateLimit.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: rateLimit.retryAfterSeconds }
          : {}),
        headers: rateLimit.headers,
      },
    };
  }

  private async request(
    url: URL,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'SkinAlpha-v2-scanner/1.0',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (response.status === 429) {
      const retryAfterSeconds = this.readRetryAfter(response.headers);

      await this.waxpeerRateLimitService.markRateLimited(retryAfterSeconds);

      throw new WaxpeerHttpError(
        `Waxpeer rate limit exceeded for ${url.pathname}.`,
        response.status,
        retryAfterSeconds,
      );
    }

    if (!response.ok) {
      const responseBody = await response.text();

      throw new WaxpeerHttpError(
        `Waxpeer request failed for ${url.pathname}: ${responseBody}`,
        response.status,
      );
    }

    return response;
  }

  private unwrapPayload(payload: unknown): WaxpeerMassInfoResponseDto {
    if (!this.isRecord(payload)) {
      throw new ServiceUnavailableException(
        'Waxpeer mass-info payload could not be parsed.',
      );
    }

    const success = this.readBoolean(payload.success);
    const msg = this.readString(payload.msg);
    const dataRecord = this.readObject(payload.data);
    const data: Record<string, WaxpeerMassInfoBucketDto> = {};

    for (const [requestedName, value] of Object.entries(dataRecord)) {
      const bucket = this.mapBucket(value);

      if (!bucket) {
        continue;
      }

      data[requestedName.trim()] = bucket;
    }

    if (success === false && Object.keys(data).length === 0) {
      throw new ServiceUnavailableException(
        `Waxpeer mass-info returned an unsuccessful payload${msg ? `: ${msg}` : '.'}`,
      );
    }

    return {
      ...(success !== undefined ? { success } : {}),
      ...(msg ? { msg } : {}),
      data,
    };
  }

  private mapBucket(value: unknown): WaxpeerMassInfoBucketDto | null {
    if (!this.isRecord(value)) {
      return null;
    }

    return {
      listings: this.readArray(value.listings)
        .map((entry) => this.mapListing(entry))
        .filter((entry): entry is WaxpeerMassInfoListingDto => entry !== null),
      ...(this.readArray(value.orders).length > 0
        ? { orders: this.readArray(value.orders) }
        : {}),
      ...(this.readArray(value.history).length > 0
        ? { history: this.readArray(value.history) }
        : {}),
      ...(Object.keys(this.readObject(value.info)).length > 0
        ? { info: this.readObject(value.info) }
        : {}),
    };
  }

  private mapListing(value: unknown): WaxpeerMassInfoListingDto | null {
    if (!this.isRecord(value)) {
      return null;
    }

    const itemId = this.readString(value.item_id);
    const name = this.readString(value.name);

    if (!itemId && !name) {
      return null;
    }

    return {
      ...(this.readNumber(value.price) !== undefined
        ? { price: this.readNumber(value.price)! }
        : {}),
      ...(this.readString(value.by) ? { by: this.readString(value.by)! } : {}),
      ...(itemId ? { item_id: itemId } : {}),
      ...(name ? { name } : {}),
      ...(this.readNumber(value.steam_price) !== undefined
        ? { steam_price: this.readNumber(value.steam_price)! }
        : {}),
      ...(this.readString(value.classid)
        ? { classid: this.readString(value.classid)! }
        : {}),
      ...(this.readString(value.image)
        ? { image: this.readString(value.image)! }
        : {}),
      ...(this.readNumber(value.paint_index) !== undefined
        ? { paint_index: this.readNumber(value.paint_index)! }
        : {}),
      ...(this.readString(value.phase)
        ? { phase: this.readString(value.phase)! }
        : {}),
      ...(this.readNumber(value.float) !== undefined
        ? { float: this.readNumber(value.float)! }
        : {}),
      ...(this.readString(value.inspect)
        ? { inspect: this.readString(value.inspect)! }
        : {}),
      ...(this.readString(value.type)
        ? { type: this.readString(value.type)! }
        : {}),
    };
  }

  private assertConfigured(): void {
    if (!this.configService.isWaxpeerEnabled()) {
      throw new ServiceUnavailableException(
        'Waxpeer ingestion is not configured.',
      );
    }
  }

  private readRetryAfter(headers: Headers): number | undefined {
    const rawValue = headers.get('retry-after');

    if (!rawValue) {
      return undefined;
    }

    const parsedValue = Number(rawValue);

    return Number.isNaN(parsedValue) ? undefined : parsedValue;
  }

  private readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : undefined;
  }

  private readNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      const parsedValue = Number(value);

      return Number.isNaN(parsedValue) ? undefined : parsedValue;
    }

    return undefined;
  }

  private readBoolean(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
  }

  private readArray(value: unknown): readonly unknown[] {
    return Array.isArray(value) ? value : [];
  }

  private readObject(value: unknown): Record<string, unknown> {
    return this.isRecord(value) ? value : {};
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
