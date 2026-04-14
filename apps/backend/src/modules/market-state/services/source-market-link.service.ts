import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AppLoggerService } from '../../../infrastructure/logging/app-logger.service';
import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';

interface SourceMarketLinkInput {
  readonly sourceCode: SourceAdapterKey;
  readonly canonicalDisplayName: string;
  readonly variantDisplayName: string;
  readonly variantMetadata: Prisma.JsonValue | null;
  readonly representativeListing: {
    readonly externalListingId: string;
    readonly title: string;
    readonly listingUrl?: string | null;
  } | null;
}

interface SourceMarketLinks {
  readonly marketUrl?: string;
  readonly listingUrl?: string;
}

@Injectable()
export class SourceMarketLinkService {
  constructor(
    @Inject(AppLoggerService)
    private readonly logger: AppLoggerService,
  ) {}

  resolveLinks(input: SourceMarketLinkInput): SourceMarketLinks {
    const persistedListingUrl = this.normalizeUrl(
      input.representativeListing?.listingUrl,
    );

    switch (input.sourceCode) {
      case 'skinport':
        return {
          ...(persistedListingUrl ? { marketUrl: persistedListingUrl } : {}),
          ...(persistedListingUrl ? { listingUrl: persistedListingUrl } : {}),
        };
      case 'csfloat': {
        const listingUrl = this.resolveCsFloatListingUrl(
          persistedListingUrl,
          input.representativeListing,
        );

        return {
          ...(listingUrl ? { marketUrl: listingUrl } : {}),
          ...(listingUrl ? { listingUrl } : {}),
        };
      }
      case 'dmarket':
        return {
          ...(persistedListingUrl ? { marketUrl: persistedListingUrl } : {}),
          ...(persistedListingUrl ? { listingUrl: persistedListingUrl } : {}),
        };
      case 'waxpeer':
        return {
          ...(persistedListingUrl ? { marketUrl: persistedListingUrl } : {}),
          ...(persistedListingUrl ? { listingUrl: persistedListingUrl } : {}),
        };
      case 'steam-snapshot': {
        const marketHashName =
          this.readMarketHashName(input.variantMetadata) ??
          this.normalizeMarketHashName(
            input.representativeListing?.title ??
              `${input.canonicalDisplayName} ${input.variantDisplayName}`,
          ) ??
          this.normalizeMarketHashName(input.canonicalDisplayName);
        const marketUrl = marketHashName
          ? this.buildSteamMarketUrl(marketHashName)
          : undefined;

        return {
          ...(marketUrl ? { marketUrl } : {}),
          ...(persistedListingUrl ? { listingUrl: persistedListingUrl } : {}),
        };
      }
      case 'backup-aggregator':
        return {
          ...(persistedListingUrl ? { marketUrl: persistedListingUrl } : {}),
          ...(persistedListingUrl ? { listingUrl: persistedListingUrl } : {}),
        };
      case 'bitskins':
        return this.resolveGenericMarketplaceLinks(
          persistedListingUrl,
          input,
          'https://bitskins.com/market/cs2',
        );
      case 'youpin':
        return this.resolveGenericMarketplaceLinks(
          persistedListingUrl,
          input,
          'https://www.youpin898.com/market/cs2',
        );
      case 'c5game':
        return this.resolveGenericMarketplaceLinks(
          persistedListingUrl,
          input,
          'https://www.c5game.com/csgo',
        );
      case 'csmoney':
        return this.resolveGenericMarketplaceLinks(
          persistedListingUrl,
          input,
          'https://cs.money/market/buy',
        );
    }
  }

  private resolveGenericMarketplaceLinks(
    persistedListingUrl: string | undefined,
    input: SourceMarketLinkInput,
    fallbackBaseUrl: string,
  ): SourceMarketLinks {
    if (persistedListingUrl) {
      return {
        marketUrl: persistedListingUrl,
        listingUrl: persistedListingUrl,
      };
    }

    const marketHashName =
      this.readMarketHashName(input.variantMetadata) ??
      this.normalizeMarketHashName(
        input.representativeListing?.title ?? input.variantDisplayName,
      );
    const marketUrl = marketHashName
      ? `${fallbackBaseUrl}?q=${encodeURIComponent(marketHashName)}`
      : undefined;

    return {
      ...(marketUrl ? { marketUrl } : {}),
    };
  }

  private resolveCsFloatListingUrl(
    persistedListingUrl: string | undefined,
    representativeListing:
      | {
          readonly externalListingId: string;
        }
      | null
      | undefined,
  ): string | undefined {
    const directListingUrl = this.buildCsFloatListingUrl(representativeListing);

    if (!persistedListingUrl) {
      return directListingUrl;
    }

    if (persistedListingUrl.includes('/api/v1/listings/')) {
      return directListingUrl;
    }

    return persistedListingUrl;
  }

  private buildCsFloatListingUrl(
    representativeListing:
      | {
          readonly externalListingId: string;
        }
      | null
      | undefined,
  ): string | undefined {
    if (!representativeListing?.externalListingId) {
      return undefined;
    }

    return `https://csfloat.com/item/${encodeURIComponent(representativeListing.externalListingId)}`;
  }

  private buildSteamMarketUrl(marketHashName: string): string {
    return `https://steamcommunity.com/market/listings/730/${encodeURIComponent(marketHashName)}`;
  }

  private readMarketHashName(
    value: Prisma.JsonValue | null,
  ): string | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    const objectValue = value as Record<string, unknown>;

    const directName =
      typeof objectValue.marketHashName === 'string'
        ? objectValue.marketHashName.trim()
        : '';

    if (directName.length > 0) {
      return directName;
    }

    if (
      Array.isArray(objectValue.marketHashNames) &&
      objectValue.marketHashNames.length > 0
    ) {
      const firstName = objectValue.marketHashNames.find(
        (entry): entry is string =>
          typeof entry === 'string' && entry.trim().length > 0,
      );

      if (firstName) {
        return firstName.trim();
      }
    }

    if (
      objectValue.mapping &&
      typeof objectValue.mapping === 'object' &&
      !Array.isArray(objectValue.mapping)
    ) {
      const mappingValue = objectValue.mapping as Record<string, unknown>;

      if (
        typeof mappingValue.marketHashName === 'string' &&
        mappingValue.marketHashName.trim().length > 0
      ) {
        return mappingValue.marketHashName.trim();
      }
    }

    return undefined;
  }

  private normalizeMarketHashName(
    value: string | undefined,
  ): string | undefined {
    if (!value) {
      return undefined;
    }

    const normalized = value.trim().replace(/\s+/g, ' ');

    return normalized.length > 0 ? normalized : undefined;
  }

  private normalizeUrl(value: string | null | undefined): string | undefined {
    if (!value) {
      return undefined;
    }

    const trimmed = value.trim();

    if (!/^https?:\/\//i.test(trimmed)) {
      this.logger.warn(
        `Ignored non-http market link "${trimmed}".`,
        SourceMarketLinkService.name,
      );
      return undefined;
    }

    return trimmed;
  }
}
