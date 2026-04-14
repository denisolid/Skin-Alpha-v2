import { ItemCategory } from '@prisma/client';
import { Injectable } from '@nestjs/common';

import { slugify } from '../infrastructure/utils/slugify.util';

const EXTERIOR_ALIASES: Readonly<Record<string, string>> = {
  fn: 'Factory New',
  'factory-new': 'Factory New',
  mw: 'Minimal Wear',
  'minimal-wear': 'Minimal Wear',
  ft: 'Field-Tested',
  'field-tested': 'Field-Tested',
  ww: 'Well-Worn',
  'well-worn': 'Well-Worn',
  bs: 'Battle-Scarred',
  'battle-scarred': 'Battle-Scarred',
};

const TYPE_ALIASES: Readonly<Record<string, ItemCategory>> = {
  skin: ItemCategory.SKIN,
  skins: ItemCategory.SKIN,
  gun: ItemCategory.SKIN,
  weapon: ItemCategory.SKIN,
  knife: ItemCategory.KNIFE,
  knives: ItemCategory.KNIFE,
  glove: ItemCategory.GLOVE,
  gloves: ItemCategory.GLOVE,
  wraps: ItemCategory.GLOVE,
  case: ItemCategory.CASE,
  cases: ItemCategory.CASE,
  capsule: ItemCategory.CAPSULE,
  capsules: ItemCategory.CAPSULE,
};

const CANONICAL_WEAPON_ALIASES: Readonly<Record<string, string>> = {
  'm9-bayonet': 'M9 Bayonet',
  bayonet: 'Bayonet',
  karambit: 'Karambit',
  'flip-knife': 'Flip Knife',
  'gut-knife': 'Gut Knife',
  'huntsman-knife': 'Huntsman Knife',
  'butterfly-knife': 'Butterfly Knife',
  'falchion-knife': 'Falchion Knife',
  'bowie-knife': 'Bowie Knife',
  'shadow-daggers': 'Shadow Daggers',
  'navaja-knife': 'Navaja Knife',
  'stiletto-knife': 'Stiletto Knife',
  'talon-knife': 'Talon Knife',
  'ursus-knife': 'Ursus Knife',
  'skeleton-knife': 'Skeleton Knife',
  'classic-knife': 'Classic Knife',
  'paracord-knife': 'Paracord Knife',
  'survival-knife': 'Survival Knife',
  'nomad-knife': 'Nomad Knife',
  'kukri-knife': 'Kukri Knife',
  'sport-gloves': 'Sport Gloves',
  'driver-gloves': 'Driver Gloves',
  'hand-wraps': 'Hand Wraps',
  'moto-gloves': 'Moto Gloves',
  'specialist-gloves': 'Specialist Gloves',
  'bloodhound-gloves': 'Bloodhound Gloves',
  'hydra-gloves': 'Hydra Gloves',
  'broken-fang-gloves': 'Broken Fang Gloves',
};

const KNIFE_WEAPON_SLUGS = new Set([
  'm9-bayonet',
  'bayonet',
  'karambit',
  'flip-knife',
  'gut-knife',
  'huntsman-knife',
  'butterfly-knife',
  'falchion-knife',
  'bowie-knife',
  'shadow-daggers',
  'navaja-knife',
  'stiletto-knife',
  'talon-knife',
  'ursus-knife',
  'skeleton-knife',
  'classic-knife',
  'paracord-knife',
  'survival-knife',
  'nomad-knife',
  'kukri-knife',
]);

const GLOVE_WEAPON_SLUGS = new Set([
  'sport-gloves',
  'driver-gloves',
  'hand-wraps',
  'moto-gloves',
  'specialist-gloves',
  'bloodhound-gloves',
  'hydra-gloves',
  'broken-fang-gloves',
]);

const STAR_SYMBOL = '\u2605';
const TRADEMARK_SYMBOL = '\u2122';

@Injectable()
export class CatalogAliasNormalizationService {
  normalizeMarketHashName(value: string): string {
    return this.normalizeWhitespace(
      value
        .replace(/\u00a0|\u2007|\u202f/gu, ' ')
        .replace(/[\u2010-\u2015]/gu, '-')
        .replace(/[\u2018\u2019\u201b\u2032]/gu, "'")
        .replace(/[\u201c\u201d\u2033]/gu, '"')
        .replace(
          /(?:ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢|Ã¢â€žÂ¢|â„¢|™|\u2122)/gu,
          TRADEMARK_SYMBOL,
        )
        .replace(
          /(?:ÃƒÂ¢Ã‹Å“Ã¢â‚¬Â¦|Ã¢Ëœâ€¦|â˜…|\u2605)/gu,
          STAR_SYMBOL,
        )
        .replace(
          new RegExp(`StatTrak(?:${TRADEMARK_SYMBOL})?`, 'giu'),
          `StatTrak${TRADEMARK_SYMBOL}`,
        ),
    );
  }

  stripQualityPrefixes(
    value: string,
    explicitFlags: {
      readonly isStatTrak?: boolean | null | undefined;
      readonly isSouvenir?: boolean | null | undefined;
    } = {},
  ): {
    readonly strippedName: string;
    readonly isStatTrak: boolean;
    readonly isSouvenir: boolean;
  } {
    const normalizedName = this.normalizeMarketHashName(value);
    const isStatTrak =
      explicitFlags.isStatTrak === true ||
      /^(?:\u2605\s+)?StatTrak(?:\u2122)?\s+/iu.test(normalizedName);
    const isSouvenir =
      explicitFlags.isSouvenir === true ||
      /^(?:\u2605\s+)?Souvenir\s+/iu.test(normalizedName);
    const strippedName = normalizedName
      .replace(/^(\u2605\s+)?StatTrak(?:\u2122)?\s+/iu, '$1')
      .replace(/^(\u2605\s+)?Souvenir\s+/iu, '$1');

    return {
      strippedName: this.normalizeWhitespace(strippedName),
      isStatTrak,
      isSouvenir,
    };
  }

  normalizeExterior(value: string | null | undefined): string | undefined {
    if (!value) {
      return undefined;
    }

    const normalizedKey = slugify(this.normalizeWhitespace(value));

    return EXTERIOR_ALIASES[normalizedKey];
  }

  extractExteriorFromTitle(value: string): string | undefined {
    const normalizedValue = this.normalizeMarketHashName(value);
    const exteriorMatch = normalizedValue.match(/\(([^)]+)\)$/u);

    return this.normalizeExterior(exteriorMatch?.[1]);
  }

  normalizeItemType(
    value: string | null | undefined,
  ): ItemCategory | undefined {
    if (!value) {
      return undefined;
    }

    return TYPE_ALIASES[slugify(value)];
  }

  normalizeWeaponName(value: string | null | undefined): string | undefined {
    if (!value) {
      return undefined;
    }

    const normalizedValue = this.normalizeWhitespace(this.stripStarPrefix(value));
    const normalizedSlug = slugify(normalizedValue);

    return CANONICAL_WEAPON_ALIASES[normalizedSlug] ?? normalizedValue;
  }

  isKnownKnifeWeapon(value: string | null | undefined): boolean {
    if (!value) {
      return false;
    }

    return KNIFE_WEAPON_SLUGS.has(slugify(this.stripStarPrefix(value)));
  }

  isKnownGloveWeapon(value: string | null | undefined): boolean {
    if (!value) {
      return false;
    }

    return GLOVE_WEAPON_SLUGS.has(slugify(this.stripStarPrefix(value)));
  }

  normalizeSkinName(value: string | null | undefined): string | undefined {
    if (!value) {
      return undefined;
    }

    return this.normalizeWhitespace(this.normalizeMarketHashName(value));
  }

  normalizePhaseHint(value: string | null | undefined): string | undefined {
    if (!value || value.trim().length === 0) {
      return undefined;
    }

    const normalizedValue = this.normalizeWhitespace(
      this.normalizeMarketHashName(value),
    ).toLowerCase();
    const hasDopplerContext = /\bgamma\s*doppler\b|\bdoppler\b/iu.test(
      normalizedValue,
    );

    if (
      /(?:^|[^a-z0-9])(?:phase|p)\s*-?\s*1(?:[^a-z0-9]|$)/iu.test(
        normalizedValue,
      )
    ) {
      return 'Phase 1';
    }

    if (
      /(?:^|[^a-z0-9])(?:phase|p)\s*-?\s*2(?:[^a-z0-9]|$)/iu.test(
        normalizedValue,
      )
    ) {
      return 'Phase 2';
    }

    if (
      /(?:^|[^a-z0-9])(?:phase|p)\s*-?\s*3(?:[^a-z0-9]|$)/iu.test(
        normalizedValue,
      )
    ) {
      return 'Phase 3';
    }

    if (
      /(?:^|[^a-z0-9])(?:phase|p)\s*-?\s*4(?:[^a-z0-9]|$)/iu.test(
        normalizedValue,
      )
    ) {
      return 'Phase 4';
    }

    if (
      (hasDopplerContext || normalizedValue === 'ruby') &&
      /(?:^|[^a-z0-9])ruby(?:[^a-z0-9]|$)/iu.test(normalizedValue)
    ) {
      return 'Ruby';
    }

    if (
      (hasDopplerContext || normalizedValue === 'sapphire') &&
      /(?:^|[^a-z0-9])sapphire(?:[^a-z0-9]|$)/iu.test(normalizedValue)
    ) {
      return 'Sapphire';
    }

    if (
      (hasDopplerContext || normalizedValue === 'black pearl') &&
      /(?:^|[^a-z0-9])black[\s-]*pearl(?:[^a-z0-9]|$)/iu.test(
        normalizedValue,
      )
    ) {
      return 'Black Pearl';
    }

    if (
      (hasDopplerContext || normalizedValue === 'emerald') &&
      /(?:^|[^a-z0-9])emerald(?:[^a-z0-9]|$)/iu.test(normalizedValue)
    ) {
      return 'Emerald';
    }

    return undefined;
  }

  normalizeRarity(
    value: string | number | null | undefined,
  ): string | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return `rarity-${Math.trunc(value)}`;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      return this.normalizeWhitespace(value);
    }

    return undefined;
  }

  normalizeWhitespace(value: string): string {
    return value.trim().replace(/\s+/gu, ' ');
  }

  hasStarPrefix(value: string | null | undefined): boolean {
    if (!value) {
      return false;
    }

    return new RegExp(`^${STAR_SYMBOL}\\s*`, 'u').test(
      this.normalizeMarketHashName(value),
    );
  }

  stripStarPrefix(value: string): string {
    return this.normalizeMarketHashName(value).replace(
      new RegExp(`^${STAR_SYMBOL}\\s*`, 'u'),
      '',
    );
  }
}
