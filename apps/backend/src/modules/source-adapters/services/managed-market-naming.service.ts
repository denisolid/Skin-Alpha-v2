import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

@Injectable()
export class ManagedMarketNamingService {
  buildMarketHashName(input: {
    readonly canonicalDisplayName: string;
    readonly variantDisplayName: string;
    readonly variantKey: string;
    readonly variantMetadata: Prisma.JsonValue | null;
    readonly sourceListingTitle?: string | null;
  }): string {
    if (
      input.sourceListingTitle &&
      input.sourceListingTitle.trim().length > 0
    ) {
      return input.sourceListingTitle.trim();
    }

    const exterior = this.readExterior(
      input.variantMetadata,
      input.variantDisplayName,
    );
    const variantKey = input.variantKey.toLowerCase();
    const isStatTrak = variantKey.includes('stattrak');
    const isSouvenir = variantKey.includes('souvenir');
    let marketHashName = input.canonicalDisplayName.trim();

    if (
      exterior &&
      !marketHashName.toLowerCase().endsWith(`(${exterior.toLowerCase()})`)
    ) {
      marketHashName = `${marketHashName} (${exterior})`;
    }

    if (isStatTrak && !marketHashName.startsWith('StatTrak')) {
      marketHashName = `StatTrak\u2122 ${marketHashName}`;
    } else if (isSouvenir && !marketHashName.startsWith('Souvenir')) {
      marketHashName = `Souvenir ${marketHashName}`;
    }

    return marketHashName;
  }

  private readExterior(
    variantMetadata: Prisma.JsonValue | null,
    variantDisplayName: string,
  ): string | null {
    if (
      variantMetadata &&
      typeof variantMetadata === 'object' &&
      !Array.isArray(variantMetadata) &&
      'exterior' in variantMetadata &&
      typeof variantMetadata.exterior === 'string' &&
      variantMetadata.exterior.trim().length > 0
    ) {
      return variantMetadata.exterior.trim();
    }

    const candidate = variantDisplayName
      .split('/')
      .map((segment) => segment.trim())
      .find(
        (segment) =>
          segment.length > 0 &&
          segment !== 'Default' &&
          segment !== 'StatTrak' &&
          segment !== 'Souvenir',
      );

    return candidate ?? null;
  }
}
