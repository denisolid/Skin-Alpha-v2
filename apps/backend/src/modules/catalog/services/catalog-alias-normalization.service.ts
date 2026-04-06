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

@Injectable()
export class CatalogAliasNormalizationService {
  normalizeMarketHashName(value: string): string {
    return this.normalizeWhitespace(
      value
        .replace(/StatTrak(?:Ã¢â€žÂ¢|â„¢)/gu, 'StatTrak™')
        .replace(/(Ã¢Ëœâ€¦|â˜…)/gu, '★')
        .replace(/\u2122/gu, '™'),
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
    let strippedName = this.normalizeMarketHashName(value);
    const isStatTrak =
      explicitFlags.isStatTrak === true ||
      /^StatTrak(?:™)?\s+/iu.test(strippedName);
    const isSouvenir =
      explicitFlags.isSouvenir === true || /^Souvenir\s+/iu.test(strippedName);

    strippedName = strippedName
      .replace(/^StatTrak(?:™)?\s+/iu, '')
      .replace(/^Souvenir\s+/iu, '');

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

    return EXTERIOR_ALIASES[normalizedKey] ?? this.normalizeWhitespace(value);
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

    const normalizedValue = this.normalizeWhitespace(
      value.replace(/^★\s*/u, ''),
    );
    const normalizedSlug = slugify(normalizedValue);

    return CANONICAL_WEAPON_ALIASES[normalizedSlug] ?? normalizedValue;
  }

  isKnownKnifeWeapon(value: string | null | undefined): boolean {
    if (!value) {
      return false;
    }

    return KNIFE_WEAPON_SLUGS.has(slugify(value.replace(/^★\s*/u, '')));
  }

  isKnownGloveWeapon(value: string | null | undefined): boolean {
    if (!value) {
      return false;
    }

    return GLOVE_WEAPON_SLUGS.has(slugify(value.replace(/^★\s*/u, '')));
  }

  normalizeSkinName(value: string | null | undefined): string | undefined {
    if (!value) {
      return undefined;
    }

    return this.normalizeWhitespace(value);
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
}
