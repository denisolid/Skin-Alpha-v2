import { ItemCategory, type Prisma } from '@prisma/client';
import { Inject, Injectable, Optional } from '@nestjs/common';

import { CatalogAliasNormalizationService } from '../../catalog/services/catalog-alias-normalization.service';

interface BuildMarketHashNameInput {
  readonly canonicalDisplayName: string;
  readonly category?: ItemCategory | null;
  readonly variantDisplayName: string;
  readonly variantKey: string;
  readonly variantMetadata: Prisma.JsonValue | null;
  readonly sourceListingTitle?: string | null;
}

@Injectable()
export class ManagedMarketNamingService {
  constructor(
    @Optional()
    @Inject(CatalogAliasNormalizationService)
    private readonly aliasNormalizationService: CatalogAliasNormalizationService = new CatalogAliasNormalizationService(),
  ) {}

  buildMarketHashName(input: BuildMarketHashNameInput): string {
    if (
      input.sourceListingTitle &&
      input.sourceListingTitle.trim().length > 0
    ) {
      return this.aliasNormalizationService.normalizeMarketHashName(
        input.sourceListingTitle,
      );
    }

    const exterior = this.readExterior(
      input.variantMetadata,
      input.variantDisplayName,
    );
    const phaseLabel = this.readPhaseLabel(
      input.variantMetadata,
      input.variantDisplayName,
    );
    const variantKey = input.variantKey.toLowerCase();
    const isStatTrak = variantKey.includes('stattrak');
    const isSouvenir = variantKey.includes('souvenir');
    const requiresStarPrefix =
      input.category === ItemCategory.KNIFE ||
      input.category === ItemCategory.GLOVE;
    let marketHashName = this.aliasNormalizationService.normalizeMarketHashName(
      input.canonicalDisplayName,
    );

    if (requiresStarPrefix && !this.aliasNormalizationService.hasStarPrefix(marketHashName)) {
      marketHashName = `\u2605 ${marketHashName}`;
    }

    if (isStatTrak) {
      marketHashName = this.insertQualityPrefix(marketHashName, 'StatTrak\u2122');
    } else if (isSouvenir) {
      marketHashName = this.insertQualityPrefix(marketHashName, 'Souvenir');
    }

    if (phaseLabel && !this.includesParentheticalToken(marketHashName, phaseLabel)) {
      marketHashName = `${marketHashName} (${phaseLabel})`;
    } else if (
      exterior &&
      !this.includesParentheticalToken(marketHashName, exterior)
    ) {
      marketHashName = `${marketHashName} (${exterior})`;
    }

    return this.aliasNormalizationService.normalizeMarketHashName(marketHashName);
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
          segment !== 'Souvenir' &&
          !this.aliasNormalizationService.normalizePhaseHint(segment),
      );

    return this.aliasNormalizationService.normalizeExterior(candidate) ?? null;
  }

  private readPhaseLabel(
    variantMetadata: Prisma.JsonValue | null,
    variantDisplayName: string,
  ): string | null {
    if (
      variantMetadata &&
      typeof variantMetadata === 'object' &&
      !Array.isArray(variantMetadata) &&
      'mapping' in variantMetadata &&
      variantMetadata.mapping &&
      typeof variantMetadata.mapping === 'object' &&
      !Array.isArray(variantMetadata.mapping) &&
      'phaseLabel' in variantMetadata.mapping &&
      typeof variantMetadata.mapping.phaseLabel === 'string' &&
      variantMetadata.mapping.phaseLabel.trim().length > 0
    ) {
      return variantMetadata.mapping.phaseLabel.trim();
    }

    for (const segment of variantDisplayName.split('/').map((value) => value.trim())) {
      const phaseLabel = this.aliasNormalizationService.normalizePhaseHint(segment);

      if (phaseLabel) {
        return phaseLabel;
      }
    }

    return null;
  }

  private insertQualityPrefix(
    value: string,
    prefix: 'StatTrak\u2122' | 'Souvenir',
  ): string {
    if (value.includes(prefix)) {
      return value;
    }

    if (this.aliasNormalizationService.hasStarPrefix(value)) {
      const strippedValue = this.aliasNormalizationService.stripStarPrefix(value);

      return `\u2605 ${prefix} ${strippedValue}`;
    }

    return `${prefix} ${value}`;
  }

  private includesParentheticalToken(value: string, token: string): boolean {
    return value.toLowerCase().includes(`(${token.toLowerCase()})`);
  }
}
