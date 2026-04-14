import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

import { AppConfigService } from '../../../infrastructure/config/app-config.service';
import { ManagedMarketSourceRuntimeService } from './managed-market-source-runtime.service';
import type {
  BitSkinsMarketItemDto,
  BitSkinsMarketSnapshotDto,
} from '../dto/bitskins-market-item.dto';

export class BitSkinsHttpError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
  }
}

@Injectable()
export class BitSkinsHttpClientService {
  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
    @Inject(ManagedMarketSourceRuntimeService)
    private readonly runtimeService: ManagedMarketSourceRuntimeService,
  ) {}

  async fetchMarketSnapshot(): Promise<BitSkinsMarketSnapshotDto> {
    this.assertConfigured();

    const requestUrl = new URL(
      'market/insell/730',
      `${this.configService.bitskinsApiBaseUrl.replace(/\/+$/, '')}/`,
    );
    const response = await fetch(requestUrl, {
      method: 'GET',
      headers: this.buildHeaders(),
      signal: AbortSignal.timeout(60_000),
    });

    await this.runtimeService.recordResponse('bitskins', response.headers);

    if (response.status === 429) {
      await this.runtimeService.markRateLimited('bitskins');

      throw new BitSkinsHttpError(
        `BitSkins rate limit exceeded for ${requestUrl.pathname}.`,
        response.status,
      );
    }

    if (!response.ok) {
      const responseBody = await response.text();

      throw new BitSkinsHttpError(
        `BitSkins request failed for ${requestUrl.pathname}: ${responseBody}`,
        response.status,
      );
    }

    const payload = await response.json();
    const list = this.unwrapPayload(payload);

    return {
      list,
      rateLimit: {
        endpoint: 'market-insell',
        headers: Object.fromEntries(response.headers.entries()),
      },
    };
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'SkinAlpha-v2-scanner/1.0',
    };

    if (this.configService.bitskinsApiKey) {
      headers['X-API-Key'] = this.configService.bitskinsApiKey;
      headers.Authorization = `Bearer ${this.configService.bitskinsApiKey}`;
    }

    return headers;
  }

  private unwrapPayload(payload: unknown): readonly BitSkinsMarketItemDto[] {
    if (
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      !Array.isArray((payload as { list?: unknown }).list)
    ) {
      throw new ServiceUnavailableException(
        'BitSkins market snapshot payload could not be parsed.',
      );
    }

    return (payload as { list: readonly unknown[] }).list
      .map((value) => this.mapItem(value))
      .filter((value): value is BitSkinsMarketItemDto => value !== null);
  }

  private mapItem(value: unknown): BitSkinsMarketItemDto | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const record = value as Record<string, unknown>;
    const name = this.readString(record.name);
    const skinId = this.readNumber(record.skin_id);

    if (!name && skinId === undefined) {
      return null;
    }

    return {
      ...(skinId !== undefined ? { skin_id: skinId } : {}),
      ...(name ? { name } : {}),
      ...(this.readNumber(record.price_min) !== undefined
        ? { price_min: this.readNumber(record.price_min)! }
        : {}),
      ...(this.readNumber(record.price_max) !== undefined
        ? { price_max: this.readNumber(record.price_max)! }
        : {}),
      ...(this.readNumber(record.price_avg) !== undefined
        ? { price_avg: this.readNumber(record.price_avg)! }
        : {}),
      ...(this.readNumber(record.quantity) !== undefined
        ? { quantity: this.readNumber(record.quantity)! }
        : {}),
    };
  }

  private assertConfigured(): void {
    if (!this.configService.isBitSkinsEnabled()) {
      throw new ServiceUnavailableException(
        'BitSkins ingestion is not configured.',
      );
    }
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

      return Number.isFinite(parsedValue) ? parsedValue : undefined;
    }

    return undefined;
  }
}
