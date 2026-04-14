import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

import { AppConfigService } from '../../../infrastructure/config/app-config.service';
import { DMARKET_GAME_ID } from '../domain/dmarket.constants';
import type {
  DMarketExtraDto,
  DMarketMarketItemDto,
  DMarketMarketItemsEnvelopeDto,
  DMarketPriceDto,
} from '../dto/dmarket-market-item.dto';
import { DMarketRateLimitService } from './dmarket-rate-limit.service';
import { DMarketSignerService } from './dmarket-signer.service';

export class DMarketHttpError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

@Injectable()
export class DMarketHttpClientService {
  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
    @Inject(DMarketRateLimitService)
    private readonly dmarketRateLimitService: DMarketRateLimitService,
    @Inject(DMarketSignerService)
    private readonly dmarketSignerService: DMarketSignerService,
  ) {}

  async fetchMarketItems(input: {
    readonly title: string;
    readonly cursor?: string;
    readonly limit?: number;
  }): Promise<DMarketMarketItemsEnvelopeDto> {
    this.assertConfigured();

    const requestUrl = new URL(
      'exchange/v1/market/items',
      `${this.configService.dmarketApiBaseUrl.replace(/\/+$/, '')}/`,
    );

    requestUrl.searchParams.set('gameId', DMARKET_GAME_ID);
    requestUrl.searchParams.set('currency', this.configService.dmarketCurrency);
    requestUrl.searchParams.set(
      'limit',
      String(input.limit ?? this.configService.dmarketPageLimit),
    );
    requestUrl.searchParams.set('title', input.title);

    if (input.cursor) {
      requestUrl.searchParams.set('cursor', input.cursor);
    }

    const response = await this.request(requestUrl);
    const payload = await response.json();
    const itemsEnvelope = this.unwrapPayload(payload);
    const rateLimit = await this.dmarketRateLimitService.recordResponse(
      response.headers,
    );

    return {
      ...itemsEnvelope,
      rateLimit: {
        endpoint: 'market-items',
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

  private async request(url: URL): Promise<Response> {
    const headers = this.dmarketSignerService.buildSignedHeaders({
      method: 'GET',
      pathWithQuery: `${url.pathname}${url.search}`,
    });
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...headers,
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (response.status === 429) {
      const retryAfterSeconds = this.readRetryAfter(response.headers);

      await this.dmarketRateLimitService.markRateLimited(retryAfterSeconds);

      throw new DMarketHttpError(
        `DMarket rate limit exceeded for ${url.pathname}.`,
        response.status,
        retryAfterSeconds,
      );
    }

    if (!response.ok) {
      const responseBody = await response.text();

      throw new DMarketHttpError(
        `DMarket request failed for ${url.pathname}: ${responseBody}`,
        response.status,
      );
    }

    return response;
  }

  private unwrapPayload(payload: unknown): DMarketMarketItemsEnvelopeDto {
    if (!this.isRecord(payload)) {
      throw new ServiceUnavailableException(
        'DMarket market-items payload could not be parsed.',
      );
    }

    const objects = Array.isArray(payload.objects)
      ? payload.objects
          .map((value) => this.mapItem(value))
          .filter((value): value is DMarketMarketItemDto => value !== null)
      : [];
    const cursor = this.readString(payload.cursor);
    const total = this.readNumber(payload.total);

    return {
      ...(cursor ? { cursor } : {}),
      ...(total !== undefined ? { total } : {}),
      objects,
    };
  }

  private mapItem(value: unknown): DMarketMarketItemDto | null {
    if (!this.isRecord(value)) {
      return null;
    }

    const title = this.readString(value.title);
    const itemId = this.readString(value.itemId);
    const extra = this.mapExtra(value.extra);

    if (!title || (!itemId && !extra?.offerId)) {
      return null;
    }

    const price = this.mapPrice(value.price);
    const instantPrice = this.mapPrice(value.instantPrice);
    const suggestedPrice = this.mapPrice(value.suggestedPrice);
    const recommendedPrice = this.mapRecommendedPrice(value.recommendedPrice);

    return {
      ...(this.readNumber(value.amount) !== undefined
        ? { amount: this.readNumber(value.amount)! }
        : {}),
      ...(this.readString(value.classId)
        ? { classId: this.readString(value.classId)! }
        : {}),
      ...(this.readNumber(value.createdAt) !== undefined
        ? { createdAt: this.readNumber(value.createdAt)! }
        : {}),
      ...(this.readString(value.description)
        ? { description: this.readString(value.description)! }
        : {}),
      ...(this.readNumber(value.discount) !== undefined
        ? { discount: this.readNumber(value.discount)! }
        : {}),
      ...(extra ? { extra } : {}),
      ...(this.readString(value.extraDoc)
        ? { extraDoc: this.readString(value.extraDoc)! }
        : {}),
      ...(this.readString(value.gameId)
        ? { gameId: this.readString(value.gameId)! }
        : {}),
      ...(this.readString(value.gameType)
        ? { gameType: this.readString(value.gameType)! }
        : {}),
      ...(this.readString(value.image)
        ? { image: this.readString(value.image)! }
        : {}),
      ...(this.readBoolean(value.inMarket) !== undefined
        ? { inMarket: this.readBoolean(value.inMarket)! }
        : {}),
      ...(instantPrice ? { instantPrice } : {}),
      ...(this.readString(value.instantTargetId)
        ? { instantTargetId: this.readString(value.instantTargetId)! }
        : {}),
      ...(itemId ? { itemId } : {}),
      ...(this.readBoolean(value.lockStatus) !== undefined
        ? { lockStatus: this.readBoolean(value.lockStatus)! }
        : {}),
      ...(this.readString(value.owner) ? { owner: this.readString(value.owner)! } : {}),
      ...(this.mapOwnerDetails(value.ownerDetails)
        ? { ownerDetails: this.mapOwnerDetails(value.ownerDetails)! }
        : {}),
      ...(this.readString(value.ownersBlockchainId)
        ? { ownersBlockchainId: this.readString(value.ownersBlockchainId)! }
        : {}),
      ...(price ? { price } : {}),
      ...(recommendedPrice ? { recommendedPrice } : {}),
      ...(this.readString(value.slug)
        ? { slug: this.readString(value.slug)! }
        : {}),
      ...(this.readString(value.status)
        ? { status: this.readString(value.status)! }
        : {}),
      ...(suggestedPrice ? { suggestedPrice } : {}),
      title,
      ...(this.readString(value.type)
        ? { type: this.readString(value.type)! }
        : {}),
    };
  }

  private mapPrice(value: unknown): DMarketPriceDto | null {
    if (!this.isRecord(value)) {
      return null;
    }

    const dmc = this.readString(value.DMC);
    const usd = this.readString(value.USD);

    if (!dmc && !usd) {
      return null;
    }

    return {
      ...(dmc ? { DMC: dmc } : {}),
      ...(usd ? { USD: usd } : {}),
    };
  }

  private mapRecommendedPrice(value: unknown) {
    if (!this.isRecord(value)) {
      return null;
    }

    const d3 = this.mapPrice(value.d3);
    const d7 = this.mapPrice(value.d7);
    const d7Plus = this.mapPrice(value.d7Plus);

    if (!d3 && !d7 && !d7Plus) {
      return null;
    }

    return {
      ...(d3 ? { d3 } : {}),
      ...(d7 ? { d7 } : {}),
      ...(d7Plus ? { d7Plus } : {}),
    };
  }

  private mapExtra(value: unknown): DMarketExtraDto | null {
    if (!this.isRecord(value)) {
      return null;
    }

    return {
      ...(this.readString(value.category)
        ? { category: this.readString(value.category)! }
        : {}),
      ...(this.readString(value.categoryPath)
        ? { categoryPath: this.readString(value.categoryPath)! }
        : {}),
      ...(Array.isArray(value.class)
        ? {
            class: value.class.filter(
              (entry): entry is string => typeof entry === 'string',
            ),
          }
        : {}),
      ...(Array.isArray(value.collection)
        ? {
            collection: value.collection.filter(
              (entry): entry is string => typeof entry === 'string',
            ),
          }
        : {}),
      ...(this.readString(value.exterior)
        ? { exterior: this.readString(value.exterior)! }
        : {}),
      ...(this.readNumber(value.floatValue) !== undefined
        ? { floatValue: this.readNumber(value.floatValue)! }
        : {}),
      ...(this.readString(value.gameId)
        ? { gameId: this.readString(value.gameId)! }
        : {}),
      ...(this.readString(value.grade)
        ? { grade: this.readString(value.grade)! }
        : {}),
      ...(this.readString(value.groupId)
        ? { groupId: this.readString(value.groupId)! }
        : {}),
      ...(this.readString(value.inspectInGame)
        ? { inspectInGame: this.readString(value.inspectInGame)! }
        : {}),
      ...(this.readBoolean(value.isNew) !== undefined
        ? { isNew: this.readBoolean(value.isNew)! }
        : {}),
      ...(this.readString(value.itemType)
        ? { itemType: this.readString(value.itemType)! }
        : {}),
      ...(this.readString(value.linkId)
        ? { linkId: this.readString(value.linkId)! }
        : {}),
      ...(this.readString(value.name) ? { name: this.readString(value.name)! } : {}),
      ...(this.readString(value.nameColor)
        ? { nameColor: this.readString(value.nameColor)! }
        : {}),
      ...(this.readString(value.offerId)
        ? { offerId: this.readString(value.offerId)! }
        : {}),
      ...(this.readString(value.phase)
        ? { phase: this.readString(value.phase)! }
        : {}),
      ...(this.readNumber(value.paintSeed) !== undefined
        ? { paintSeed: this.readNumber(value.paintSeed)! }
        : {}),
      ...(this.readString(value.quality)
        ? { quality: this.readString(value.quality)! }
        : {}),
      ...(this.readString(value.rarity)
        ? { rarity: this.readString(value.rarity)! }
        : {}),
      ...(this.readNumber(value.serialNumber) !== undefined
        ? { serialNumber: this.readNumber(value.serialNumber)! }
        : {}),
      ...(Array.isArray(value.stickers)
        ? {
            stickers: value.stickers
              .map((sticker) => this.mapSticker(sticker))
              .filter((sticker): sticker is NonNullable<typeof sticker> =>
                Boolean(sticker),
              ),
          }
        : {}),
      ...(this.readNumber(value.subscribers) !== undefined
        ? { subscribers: this.readNumber(value.subscribers)! }
        : {}),
      ...(this.readString(value.tagName)
        ? { tagName: this.readString(value.tagName)! }
        : {}),
      ...(this.readBoolean(value.tradable) !== undefined
        ? { tradable: this.readBoolean(value.tradable)! }
        : {}),
      ...(this.readNumber(value.tradeLock) !== undefined
        ? { tradeLock: this.readNumber(value.tradeLock)! }
        : {}),
      ...(this.readNumber(value.tradeLockDuration) !== undefined
        ? { tradeLockDuration: this.readNumber(value.tradeLockDuration)! }
        : {}),
      ...(this.readString(value.type) ? { type: this.readString(value.type)! } : {}),
      ...(this.readNumber(value.videos) !== undefined
        ? { videos: this.readNumber(value.videos)! }
        : {}),
      ...(this.readString(value.viewAtSteam)
        ? { viewAtSteam: this.readString(value.viewAtSteam)! }
        : {}),
      ...(this.readBoolean(value.withdrawable) !== undefined
        ? { withdrawable: this.readBoolean(value.withdrawable)! }
        : {}),
    };
  }

  private mapSticker(value: unknown) {
    if (!this.isRecord(value)) {
      return null;
    }

    const image = this.readString(value.image);
    const name = this.readString(value.name);
    const type = this.readString(value.type);

    if (!image && !name && !type) {
      return null;
    }

    return {
      ...(image ? { image } : {}),
      ...(name ? { name } : {}),
      ...(type ? { type } : {}),
    };
  }

  private mapOwnerDetails(value: unknown) {
    if (!this.isRecord(value)) {
      return null;
    }

    const avatar = this.readString(value.avatar);
    const id = this.readString(value.id);
    const wallet = this.readString(value.wallet);

    if (!avatar && !id && !wallet) {
      return null;
    }

    return {
      ...(avatar ? { avatar } : {}),
      ...(id ? { id } : {}),
      ...(wallet ? { wallet } : {}),
    };
  }

  private assertConfigured(): void {
    if (!this.configService.isDMarketEnabled()) {
      throw new ServiceUnavailableException(
        'DMarket ingestion is not configured.',
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

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
