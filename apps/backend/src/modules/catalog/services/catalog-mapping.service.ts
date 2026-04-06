import { ItemCategory, VariantPhase } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import type { CatalogItemMappingDto } from '../dto/catalog-item-mapping.dto';
import type { CatalogSourceListingInputDto } from '../dto/catalog-source-listing-input.dto';
import { slugify } from '../infrastructure/utils/slugify.util';
import { CatalogAliasNormalizationService } from './catalog-alias-normalization.service';

interface ParsedNameStructure {
  readonly category: ItemCategory;
  readonly weapon?: string;
  readonly skinName?: string;
  readonly baseName: string;
  readonly exterior?: string;
  readonly isVanilla: boolean;
  readonly warnings: readonly string[];
}

interface ParsedPhaseInfo {
  readonly phase?: VariantPhase;
  readonly phaseLabel?: string;
  readonly isDoppler: boolean;
  readonly isGammaDoppler: boolean;
  readonly isGammaPhase: boolean;
}

@Injectable()
export class CatalogMappingService {
  constructor(
    @Inject(CatalogAliasNormalizationService)
    private readonly aliasNormalizationService: CatalogAliasNormalizationService,
  ) {}

  mapSourceListing(input: CatalogSourceListingInputDto): CatalogItemMappingDto {
    const normalizedMarketHashName =
      this.aliasNormalizationService.normalizeMarketHashName(
        input.marketHashName,
      );
    const decoratorInfo = this.aliasNormalizationService.stripQualityPrefixes(
      normalizedMarketHashName,
      {
        isStatTrak: input.isStatTrak,
        isSouvenir: input.isSouvenir,
      },
    );
    const explicitExterior = this.aliasNormalizationService.normalizeExterior(
      input.exterior,
    );
    const explicitCategory = this.aliasNormalizationService.normalizeItemType(
      input.type,
    );
    const baseNameInfo = this.extractExterior(
      decoratorInfo.strippedName,
      explicitExterior,
    );
    const structure = this.parseStructure({
      baseName: baseNameInfo.baseName,
      explicitCategory,
      explicitWeapon: input.weapon,
      explicitSkinName: input.skinName,
      explicitExterior: baseNameInfo.exterior,
    });
    const phaseInfo = this.parsePhase(
      input.phaseHint,
      structure.skinName ?? structure.baseName,
    );
    const rarity = this.aliasNormalizationService.normalizeRarity(input.rarity);
    const canonicalDisplayName = this.buildCanonicalDisplayName(structure);
    const variantTokens = [
      ...(structure.isVanilla ? ['Vanilla'] : []),
      ...(structure.exterior ? [structure.exterior] : []),
      ...(phaseInfo.phaseLabel ? [phaseInfo.phaseLabel] : []),
      ...(decoratorInfo.isStatTrak ? ['StatTrak'] : []),
      ...(decoratorInfo.isSouvenir ? ['Souvenir'] : []),
    ];
    const variantDisplayName = variantTokens.join(' / ') || 'Default';
    const variantKey = variantTokens.length
      ? variantTokens.map((token) => slugify(token)).join(':')
      : 'default';
    const warnings = [
      ...structure.warnings,
      ...(canonicalDisplayName.length === 0
        ? ['Catalog parser did not derive a stable canonical display name.']
        : []),
    ];

    return {
      marketHashName: normalizedMarketHashName,
      canonicalSlug: slugify(canonicalDisplayName),
      canonicalDisplayName,
      category: structure.category,
      type: this.mapCategoryToType(structure.category),
      ...(structure.weapon ? { weapon: structure.weapon } : {}),
      ...(structure.skinName ? { skinName: structure.skinName } : {}),
      ...(structure.exterior ? { exterior: structure.exterior } : {}),
      ...(rarity ? { rarity } : {}),
      stattrak: decoratorInfo.isStatTrak,
      souvenir: decoratorInfo.isSouvenir,
      ...(input.defIndex !== null && input.defIndex !== undefined
        ? { defIndex: input.defIndex }
        : {}),
      ...(input.paintIndex !== null && input.paintIndex !== undefined
        ? { paintIndex: input.paintIndex }
        : {}),
      ...(phaseInfo.phase ? { phase: phaseInfo.phase } : {}),
      ...(phaseInfo.phaseLabel ? { phaseLabel: phaseInfo.phaseLabel } : {}),
      isGammaPhase: phaseInfo.isGammaPhase,
      isVanilla: structure.isVanilla,
      isDoppler: phaseInfo.isDoppler,
      isGammaDoppler: phaseInfo.isGammaDoppler,
      patternRelevant: this.isPatternRelevant(
        structure.skinName ?? structure.baseName,
        input.paintIndex,
      ),
      floatRelevant: this.isFloatRelevant(structure.category),
      variantKey,
      variantDisplayName,
      confidence: this.computeConfidence({
        category: structure.category,
        canonicalDisplayName,
        hasWeapon: Boolean(structure.weapon),
        hasSkinName: Boolean(structure.skinName),
        hasExterior: Boolean(structure.exterior),
        hasDefIndex: input.defIndex !== null && input.defIndex !== undefined,
        hasPaintIndex:
          input.paintIndex !== null && input.paintIndex !== undefined,
        isVanilla: structure.isVanilla,
        hasWarnings: warnings.length > 0,
      }),
      warnings,
    };
  }

  private parseStructure(input: {
    readonly baseName: string;
    readonly explicitCategory?: ItemCategory | undefined;
    readonly explicitWeapon?: string | null | undefined;
    readonly explicitSkinName?: string | null | undefined;
    readonly explicitExterior?: string | undefined;
  }): ParsedNameStructure {
    const category =
      input.explicitCategory ?? this.deriveCategory(input.baseName);
    const normalizedWeapon = this.aliasNormalizationService.normalizeWeaponName(
      input.explicitWeapon,
    );
    const normalizedSkinName = this.aliasNormalizationService.normalizeSkinName(
      input.explicitSkinName,
    );

    if (category === ItemCategory.CASE || category === ItemCategory.CAPSULE) {
      const resolvedSkinName =
        normalizedSkinName ??
        this.aliasNormalizationService.normalizeSkinName(input.baseName);

      return {
        category,
        ...(resolvedSkinName ? { skinName: resolvedSkinName } : {}),
        baseName: input.baseName,
        ...(input.explicitExterior ? { exterior: input.explicitExterior } : {}),
        isVanilla: false,
        warnings: [],
      };
    }

    if (normalizedWeapon || normalizedSkinName) {
      return {
        category,
        ...(normalizedWeapon ? { weapon: normalizedWeapon } : {}),
        ...(normalizedSkinName ? { skinName: normalizedSkinName } : {}),
        baseName: input.baseName,
        ...(input.explicitExterior ? { exterior: input.explicitExterior } : {}),
        isVanilla:
          category !== ItemCategory.SKIN &&
          Boolean(normalizedWeapon) &&
          !normalizedSkinName,
        warnings:
          category === ItemCategory.SKIN && !normalizedSkinName
            ? [
                'Catalog parser expected a skin finish name but none was provided.',
              ]
            : [],
      };
    }

    const segments = input.baseName
      .split(' | ')
      .map((segment) => segment.trim());

    if (segments.length >= 2) {
      const [weaponSegment, ...skinSegments] = segments;
      const resolvedWeapon =
        this.aliasNormalizationService.normalizeWeaponName(weaponSegment);
      const resolvedSkinName = this.aliasNormalizationService.normalizeSkinName(
        skinSegments.join(' | '),
      );

      return {
        category,
        ...(resolvedWeapon ? { weapon: resolvedWeapon } : {}),
        ...(resolvedSkinName ? { skinName: resolvedSkinName } : {}),
        baseName: input.baseName,
        ...(input.explicitExterior ? { exterior: input.explicitExterior } : {}),
        isVanilla: false,
        warnings: [],
      };
    }

    if (category === ItemCategory.KNIFE || category === ItemCategory.GLOVE) {
      const resolvedWeapon = this.aliasNormalizationService.normalizeWeaponName(
        input.baseName,
      );

      return {
        category,
        ...(resolvedWeapon ? { weapon: resolvedWeapon } : {}),
        baseName: input.baseName,
        ...(input.explicitExterior ? { exterior: input.explicitExterior } : {}),
        isVanilla: true,
        warnings: [],
      };
    }

    return {
      category,
      baseName: input.baseName,
      ...(input.explicitExterior ? { exterior: input.explicitExterior } : {}),
      isVanilla: false,
      warnings: [
        'Catalog parser could not deterministically split weapon and skin name.',
      ],
    };
  }

  private deriveCategory(baseName: string): ItemCategory {
    if (/capsule/iu.test(baseName)) {
      return ItemCategory.CAPSULE;
    }

    if (/case/iu.test(baseName)) {
      return ItemCategory.CASE;
    }

    const leadingSegment = baseName.split(' | ')[0]?.trim() ?? baseName;
    const normalizedWeapon =
      this.aliasNormalizationService.normalizeWeaponName(leadingSegment);

    if (
      this.aliasNormalizationService.isKnownGloveWeapon(normalizedWeapon) ||
      (normalizedWeapon !== undefined &&
        /gloves|glove|wraps/iu.test(normalizedWeapon))
    ) {
      return ItemCategory.GLOVE;
    }

    if (
      leadingSegment.startsWith('★') ||
      this.aliasNormalizationService.isKnownKnifeWeapon(normalizedWeapon)
    ) {
      return ItemCategory.KNIFE;
    }

    return ItemCategory.SKIN;
  }

  private extractExterior(
    strippedName: string,
    explicitExterior?: string,
  ): { readonly baseName: string; readonly exterior?: string } {
    if (explicitExterior) {
      const suffixPattern = new RegExp(
        `\\s+\\(${explicitExterior.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\)$`,
        'iu',
      );

      return {
        baseName: this.aliasNormalizationService.normalizeWhitespace(
          strippedName.replace(suffixPattern, ''),
        ),
        exterior: explicitExterior,
      };
    }

    const exteriorMatch = strippedName.match(/\(([^)]+)\)$/u);
    const normalizedExterior = this.aliasNormalizationService.normalizeExterior(
      exteriorMatch?.[1],
    );

    return {
      baseName: normalizedExterior
        ? this.aliasNormalizationService.normalizeWhitespace(
            strippedName.replace(/\s+\([^)]+\)$/u, ''),
          )
        : strippedName,
      ...(normalizedExterior ? { exterior: normalizedExterior } : {}),
    };
  }

  private parsePhase(
    phaseHint: string | null | undefined,
    nameValue: string,
  ): ParsedPhaseInfo {
    const candidateValue = this.aliasNormalizationService
      .normalizeWhitespace(
        phaseHint && phaseHint.trim().length > 0 ? phaseHint : nameValue,
      )
      .toLowerCase();
    const isGammaDoppler = /gamma doppler/iu.test(candidateValue);
    const isDoppler = /doppler/iu.test(candidateValue);
    const phaseLabel = this.extractPhaseLabel(candidateValue);

    if (!phaseLabel) {
      return {
        isDoppler,
        isGammaDoppler,
        isGammaPhase: false,
      };
    }

    const mappedPhase = this.mapPhaseLabel(phaseLabel);

    return {
      ...(mappedPhase ? { phase: mappedPhase } : {}),
      phaseLabel,
      isDoppler: isDoppler || phaseLabel !== undefined,
      isGammaDoppler,
      isGammaPhase: isGammaDoppler,
    };
  }

  private extractPhaseLabel(candidateValue: string): string | undefined {
    if (/phase 1/iu.test(candidateValue)) {
      return 'Phase 1';
    }

    if (/phase 2/iu.test(candidateValue)) {
      return 'Phase 2';
    }

    if (/phase 3/iu.test(candidateValue)) {
      return 'Phase 3';
    }

    if (/phase 4/iu.test(candidateValue)) {
      return 'Phase 4';
    }

    if (/ruby/iu.test(candidateValue)) {
      return 'Ruby';
    }

    if (/sapphire/iu.test(candidateValue)) {
      return 'Sapphire';
    }

    if (/black pearl/iu.test(candidateValue)) {
      return 'Black Pearl';
    }

    if (/emerald/iu.test(candidateValue)) {
      return 'Emerald';
    }

    return undefined;
  }

  private mapPhaseLabel(
    phaseLabel: string | undefined,
  ): VariantPhase | undefined {
    switch (phaseLabel?.toLowerCase()) {
      case 'phase 1':
        return VariantPhase.PHASE_1;
      case 'phase 2':
        return VariantPhase.PHASE_2;
      case 'phase 3':
        return VariantPhase.PHASE_3;
      case 'phase 4':
        return VariantPhase.PHASE_4;
      case 'ruby':
        return VariantPhase.RUBY;
      case 'sapphire':
        return VariantPhase.SAPPHIRE;
      case 'black pearl':
        return VariantPhase.BLACK_PEARL;
      case 'emerald':
        return VariantPhase.EMERALD;
      default:
        return undefined;
    }
  }

  private buildCanonicalDisplayName(structure: ParsedNameStructure): string {
    if (structure.category === ItemCategory.CASE) {
      return structure.baseName;
    }

    if (structure.category === ItemCategory.CAPSULE) {
      return structure.baseName;
    }

    if (structure.isVanilla && structure.weapon) {
      return structure.weapon;
    }

    if (structure.weapon && structure.skinName) {
      return `${structure.weapon} | ${structure.skinName}`;
    }

    if (structure.skinName) {
      return structure.skinName;
    }

    return structure.baseName;
  }

  private isPatternRelevant(
    nameValue: string,
    paintIndex?: number | null,
  ): boolean {
    if (paintIndex === 44 || paintIndex === 1004) {
      return true;
    }

    return /case hardened|crimson web|fade/iu.test(nameValue);
  }

  private isFloatRelevant(category: ItemCategory): boolean {
    return (
      category === ItemCategory.SKIN ||
      category === ItemCategory.KNIFE ||
      category === ItemCategory.GLOVE
    );
  }

  private mapCategoryToType(category: ItemCategory): string {
    switch (category) {
      case ItemCategory.KNIFE:
        return 'knife';
      case ItemCategory.GLOVE:
        return 'glove';
      case ItemCategory.CASE:
        return 'case';
      case ItemCategory.CAPSULE:
        return 'capsule';
      case ItemCategory.SKIN:
      default:
        return 'skin';
    }
  }

  private computeConfidence(input: {
    readonly category: ItemCategory;
    readonly canonicalDisplayName: string;
    readonly hasWeapon: boolean;
    readonly hasSkinName: boolean;
    readonly hasExterior: boolean;
    readonly hasDefIndex: boolean;
    readonly hasPaintIndex: boolean;
    readonly isVanilla: boolean;
    readonly hasWarnings: boolean;
  }): number {
    let confidence = 0.35;

    if (input.canonicalDisplayName.length > 0) {
      confidence += 0.2;
    }

    if (
      input.category === ItemCategory.CASE ||
      input.category === ItemCategory.CAPSULE
    ) {
      confidence += 0.2;
    } else if (input.hasWeapon && (input.hasSkinName || input.isVanilla)) {
      confidence += 0.25;
    }

    if (input.hasExterior) {
      confidence += 0.05;
    }

    if (input.hasDefIndex) {
      confidence += 0.075;
    }

    if (input.hasPaintIndex) {
      confidence += 0.075;
    }

    if (input.hasWarnings) {
      confidence -= 0.2;
    }

    return Number(Math.max(0, Math.min(1, confidence)).toFixed(4));
  }
}
