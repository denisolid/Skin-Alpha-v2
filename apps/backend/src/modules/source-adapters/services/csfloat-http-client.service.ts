import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

import { AppConfigService } from '../../../infrastructure/config/app-config.service';
import type {
  CsFloatItemDto,
  CsFloatListingDetailEnvelopeDto,
  CsFloatListingDto,
  CsFloatListingsEnvelopeDto,
  CsFloatListingsFilterDto,
  CsFloatSellerDto,
  CsFloatStickerDto,
} from '../dto/csfloat-listing-payload.dto';
import { CsFloatRateLimitService } from './csfloat-rate-limit.service';

export class CsFloatHttpError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

@Injectable()
export class CsFloatHttpClientService {
  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
    @Inject(CsFloatRateLimitService)
    private readonly csfloatRateLimitService: CsFloatRateLimitService,
  ) {}

  async fetchListingsPage(input: {
    cursor?: string;
    filters?: CsFloatListingsFilterDto;
    limit?: number;
    page: number;
  }): Promise<CsFloatListingsEnvelopeDto> {
    this.assertConfigured();

    const requestUrl = new URL(
      'listings',
      `${this.configService.csfloatApiBaseUrl.replace(/\/+$/, '')}/`,
    );
    const limit = input.limit ?? this.configService.csfloatListingsPageLimit;

    requestUrl.searchParams.set('limit', String(limit));

    if (input.cursor) {
      requestUrl.searchParams.set('cursor', input.cursor);
    }

    if (input.filters?.marketHashName) {
      requestUrl.searchParams.set(
        'market_hash_name',
        input.filters.marketHashName,
      );
    }
    if (input.filters?.minPrice !== undefined) {
      requestUrl.searchParams.set('min_price', String(input.filters.minPrice));
    }
    if (input.filters?.maxPrice !== undefined) {
      requestUrl.searchParams.set('max_price', String(input.filters.maxPrice));
    }
    if (input.filters?.minFloat !== undefined) {
      requestUrl.searchParams.set('min_float', String(input.filters.minFloat));
    }
    if (input.filters?.maxFloat !== undefined) {
      requestUrl.searchParams.set('max_float', String(input.filters.maxFloat));
    }
    if (input.filters?.rarity !== undefined) {
      requestUrl.searchParams.set('rarity', String(input.filters.rarity));
    }
    if (input.filters?.sortBy) {
      requestUrl.searchParams.set('sort_by', input.filters.sortBy);
    }

    const response = await this.request(requestUrl, 'listings');
    const payload = await response.json();
    const { listings, nextCursor } = this.unwrapListingsPayload(
      payload,
      response.headers,
    );
    const rateLimit = await this.csfloatRateLimitService.recordResponse(
      'listings',
      response.headers,
    );

    return {
      listings,
      pagination: {
        ...(input.cursor ? { cursor: input.cursor } : {}),
        ...(nextCursor ? { nextCursor } : {}),
        limit,
        page: input.page,
        ...(input.filters ? { filters: input.filters } : {}),
      },
      rateLimit: {
        endpoint: 'listings',
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

  async fetchListingDetail(
    listingId: string,
  ): Promise<CsFloatListingDetailEnvelopeDto> {
    this.assertConfigured();

    const requestUrl = new URL(
      `listings/${encodeURIComponent(listingId)}`,
      `${this.configService.csfloatApiBaseUrl.replace(/\/+$/, '')}/`,
    );
    const response = await this.request(requestUrl, 'listing-detail');
    const payload = await response.json();
    const listing = this.unwrapListingDetailPayload(payload);
    const rateLimit = await this.csfloatRateLimitService.recordResponse(
      'listing-detail',
      response.headers,
    );

    return {
      listing,
      rateLimit: {
        endpoint: 'listing-detail',
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
    endpoint: 'listings' | 'listing-detail',
  ): Promise<Response> {
    // Base URL and raw API key are configured through CSFLOAT_API_BASE_URL and
    // CSFLOAT_API_KEY in the backend environment.
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: this.configService.csfloatApiKey!,
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (response.status === 429) {
      const retryAfterSeconds = this.readRetryAfter(response.headers);

      await this.csfloatRateLimitService.markRateLimited(
        endpoint,
        retryAfterSeconds,
      );

      throw new CsFloatHttpError(
        `CSFloat rate limit exceeded for ${url.pathname}.`,
        response.status,
        retryAfterSeconds,
      );
    }

    if (!response.ok) {
      const responseBody = await response.text();

      throw new CsFloatHttpError(
        `CSFloat request failed for ${url.pathname}: ${responseBody}`,
        response.status,
      );
    }

    return response;
  }

  private unwrapListingsPayload(
    payload: unknown,
    headers: Headers,
  ): {
    listings: CsFloatListingDto[];
    nextCursor?: string;
  } {
    if (Array.isArray(payload)) {
      const nextCursor = this.readNextCursor(undefined, headers);

      return {
        listings: payload
          .map((value) => this.mapListing(value))
          .filter((value): value is CsFloatListingDto => value !== null),
        ...(nextCursor ? { nextCursor } : {}),
      };
    }

    if (this.isRecord(payload)) {
      const listingsPayload = Array.isArray(payload.listings)
        ? payload.listings
        : Array.isArray(payload.items)
          ? payload.items
          : Array.isArray(payload.data)
            ? payload.data
            : [];
      const nextCursor = this.readNextCursor(payload, headers);

      return {
        listings: listingsPayload
          .map((value) => this.mapListing(value))
          .filter((value): value is CsFloatListingDto => value !== null),
        ...(nextCursor ? { nextCursor } : {}),
      };
    }

    throw new ServiceUnavailableException(
      'CSFloat listings payload could not be parsed.',
    );
  }

  private unwrapListingDetailPayload(payload: unknown): CsFloatListingDto {
    if (this.isRecord(payload) && this.isRecord(payload.data)) {
      const listing = this.mapListing(payload.data);

      if (listing) {
        return listing;
      }
    }

    if (this.isRecord(payload)) {
      const listing = this.mapListing(payload);

      if (listing) {
        return listing;
      }
    }

    throw new ServiceUnavailableException(
      'CSFloat listing detail payload could not be parsed.',
    );
  }

  private mapListing(value: unknown): CsFloatListingDto | null {
    if (!this.isRecord(value)) {
      return null;
    }

    const item = this.mapItem(value.item);
    const id = this.readString(value.id);
    const price = this.readNumber(value.price);

    if (!item || !id || price === undefined) {
      return null;
    }

    const seller = this.mapSeller(value.seller);
    const createdAt =
      this.readString(value.created_at) || this.readString(value.createdAt);
    const state = this.readString(value.state);
    const type = this.readString(value.type);
    const minOfferPrice = this.readNumber(value.min_offer_price);
    const maxOfferDiscount = this.readNumber(value.max_offer_discount);
    const watchers = this.readNumber(value.watchers);

    return {
      id,
      price,
      ...(state ? { state } : {}),
      ...(type ? { type } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(seller ? { seller } : {}),
      item,
      ...(minOfferPrice !== undefined ? { minOfferPrice } : {}),
      ...(maxOfferDiscount !== undefined ? { maxOfferDiscount } : {}),
      ...(watchers !== undefined ? { watchers } : {}),
    };
  }

  private mapItem(value: unknown): CsFloatItemDto | null {
    if (!this.isRecord(value)) {
      return null;
    }

    const assetId =
      this.readString(value.asset_id) || this.readString(value.assetId);
    const marketHashName =
      this.readString(value.market_hash_name) ||
      this.readString(value.marketHashName);

    if (!assetId || !marketHashName) {
      return null;
    }

    const inspectLink =
      this.readString(value.inspect_link) || this.readString(value.inspectLink);
    const iconUrl =
      this.readString(value.icon_url) || this.readString(value.iconUrl);
    const collection = this.readString(value.collection);
    const itemName =
      this.readString(value.item_name) || this.readString(value.itemName);
    const wearName =
      this.readString(value.wear_name) || this.readString(value.wearName);
    const floatValue =
      this.readNumber(value.float_value) ?? this.readNumber(value.floatValue);
    const paintSeed =
      this.readNumber(value.paint_seed) ?? this.readNumber(value.paintSeed);
    const defIndex =
      this.readNumber(value.def_index) ?? this.readNumber(value.defIndex);
    const paintIndex =
      this.readNumber(value.paint_index) ?? this.readNumber(value.paintIndex);
    const isStatTrak =
      this.readBoolean(value.is_stattrak) ?? this.readBoolean(value.isStatTrak);
    const isSouvenir =
      this.readBoolean(value.is_souvenir) ?? this.readBoolean(value.isSouvenir);
    const stickers = Array.isArray(value.stickers)
      ? value.stickers
          .map((sticker) => this.mapSticker(sticker))
          .filter((sticker): sticker is CsFloatStickerDto => sticker !== null)
      : undefined;
    const scm = this.mapScmHint(value.scm);

    return {
      assetId,
      marketHashName,
      ...(inspectLink ? { inspectLink } : {}),
      ...(iconUrl ? { iconUrl } : {}),
      ...(collection ? { collection } : {}),
      ...(itemName ? { itemName } : {}),
      ...(wearName ? { wearName } : {}),
      ...(this.readNumber(value.rarity) !== undefined
        ? { rarity: this.readNumber(value.rarity)! }
        : {}),
      ...(this.readNumber(value.quality) !== undefined
        ? { quality: this.readNumber(value.quality)! }
        : {}),
      ...(this.readNumber(value.tradable) !== undefined
        ? { tradable: this.readNumber(value.tradable)! }
        : {}),
      ...(floatValue !== undefined ? { floatValue } : {}),
      ...(paintSeed !== undefined ? { paintSeed } : {}),
      ...(defIndex !== undefined ? { defIndex } : {}),
      ...(paintIndex !== undefined ? { paintIndex } : {}),
      ...(isStatTrak !== undefined ? { isStatTrak } : {}),
      ...(isSouvenir !== undefined ? { isSouvenir } : {}),
      ...(stickers ? { stickers } : {}),
      ...(scm ? { scm } : {}),
    };
  }

  private mapSticker(value: unknown): CsFloatStickerDto | null {
    if (!this.isRecord(value)) {
      return null;
    }

    const stickerId =
      this.readNumber(value.stickerId) ?? this.readNumber(value.sticker_id);
    const slot = this.readNumber(value.slot);
    const wear = this.readNumber(value.wear);
    const name = this.readString(value.name);
    const iconUrl =
      this.readString(value.icon_url) || this.readString(value.iconUrl);
    const scm = this.mapScmHint(value.scm);

    return {
      ...(stickerId !== undefined ? { stickerId } : {}),
      ...(slot !== undefined ? { slot } : {}),
      ...(wear !== undefined ? { wear } : {}),
      ...(name ? { name } : {}),
      ...(iconUrl ? { iconUrl } : {}),
      ...(scm ? { scm } : {}),
    };
  }

  private mapScmHint(
    value: unknown,
  ): CsFloatItemDto['scm'] | CsFloatStickerDto['scm'] | null {
    if (!this.isRecord(value)) {
      return null;
    }

    const price = this.readNumber(value.price);
    const volume = this.readNumber(value.volume);

    if (price === undefined && volume === undefined) {
      return null;
    }

    return {
      ...(price !== undefined ? { price } : {}),
      ...(volume !== undefined ? { volume } : {}),
    };
  }

  private mapSeller(value: unknown): CsFloatSellerDto | null {
    if (!this.isRecord(value)) {
      return null;
    }

    const id = this.readString(value.id);
    const username = this.readString(value.username);
    const steamId =
      this.readString(value.steam_id) || this.readString(value.steamId);
    const avatarUrl =
      this.readString(value.avatar) || this.readString(value.avatar_url);
    const statistics = this.mapSellerStatistics(value.statistics);

    return {
      ...(id ? { id } : {}),
      ...(steamId ? { steamId } : {}),
      ...(username ? { username } : {}),
      ...(avatarUrl ? { avatarUrl } : {}),
      ...(this.readBoolean(value.online) !== undefined
        ? { online: this.readBoolean(value.online)! }
        : {}),
      ...(this.readBoolean(value.stall_public) !== undefined
        ? { stallPublic: this.readBoolean(value.stall_public)! }
        : {}),
      ...(statistics ? { statistics } : {}),
    };
  }

  private mapSellerStatistics(
    value: unknown,
  ): CsFloatSellerDto['statistics'] | null {
    if (!this.isRecord(value)) {
      return null;
    }

    const totalTrades =
      this.readNumber(value.total_trades) ?? this.readNumber(value.totalTrades);
    const successfulTrades =
      this.readNumber(value.successful_trades) ??
      this.readNumber(value.successfulTrades);
    const medianTradeTimeHours =
      this.readNumber(value.median_trade_time_hours) ??
      this.readNumber(value.medianTradeTimeHours);

    if (
      totalTrades === undefined &&
      successfulTrades === undefined &&
      medianTradeTimeHours === undefined
    ) {
      return null;
    }

    return {
      ...(totalTrades !== undefined ? { totalTrades } : {}),
      ...(successfulTrades !== undefined ? { successfulTrades } : {}),
      ...(medianTradeTimeHours !== undefined ? { medianTradeTimeHours } : {}),
    };
  }

  private assertConfigured(): void {
    if (!this.configService.isCsFloatConfigured()) {
      throw new ServiceUnavailableException(
        'CSFloat ingestion is not configured.',
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

  private readNextCursor(
    payload: Record<string, unknown> | undefined,
    headers: Headers,
  ): string | undefined {
    const headerCursor =
      headers.get('x-next-cursor') ||
      headers.get('next-cursor') ||
      headers.get('cursor');

    if (headerCursor && headerCursor.trim().length > 0) {
      return headerCursor.trim();
    }

    if (!payload) {
      return undefined;
    }

    return (
      this.readString(payload.next_cursor) ||
      this.readString(payload.nextCursor) ||
      this.readString(payload.cursor)
    );
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
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'number') {
      return value === 1;
    }

    return undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
