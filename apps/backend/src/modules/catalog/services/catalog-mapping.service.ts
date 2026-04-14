import { ItemCategory, VariantPhase } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import type { CatalogItemMappingDto } from '../dto/catalog-item-mapping.dto';
import type { CatalogSourceListingInputDto } from '../dto/catalog-source-listing-input.dto';
import { slugify } from '../infrastructure/utils/slugify.util';
import { CatalogAliasNormalizationService } from './catalog-alias-normalization.service';
import { CatalogPhaseNormalizationService } from './catalog-phase-normalization.service';
import { VariantSignalPolicyService } from './variant-signal-policy.service';

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
  readonly phaseFamily: CatalogItemMappingDto['phaseFamily'];
  readonly phase?: VariantPhase;
  readonly phaseLabel?: string;
  readonly isDoppler: boolean;
  readonly isGammaDoppler: boolean;
  readonly isGammaPhase: boolean;
  readonly confidence: number;
  readonly warnings: readonly string[];
}

@Injectable()
export class CatalogMappingService {
  constructor(
    @Inject(CatalogAliasNormalizationService)
    private readonly aliasNormalizationService: CatalogAliasNormalizationService,
    @Inject(CatalogPhaseNormalizationService)
    private readonly phaseNormalizationService: CatalogPhaseNormalizationService,
    @Inject(VariantSignalPolicyService)
    private readonly variantSignalPolicyService: VariantSignalPolicyService,
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
    const phaseBaseName = this.stripTrailingPhaseSuffix(baseNameInfo.baseName);
    const structure = this.parseStructure({
      baseName: phaseBaseName,
      explicitCategory,
      explicitWeapon: input.weapon,
      explicitSkinName: input.skinName,
      explicitExterior: baseNameInfo.exterior,
    });
    const phaseInfo = this.parsePhase({
      category: structure.category,
      isVanilla: structure.isVanilla,
      phaseHint: input.phaseHint,
      nameValue: structure.skinName ?? structure.baseName,
    });
    const signalPolicy = this.variantSignalPolicyService.resolve({
      category: structure.category,
      nameValue: structure.skinName ?? structure.baseName,
      isVanilla: structure.isVanilla,
      ...(structure.exterior ? { exterior: structure.exterior } : {}),
      ...(input.paintIndex !== null && input.paintIndex !== undefined
        ? { paintIndex: input.paintIndex }
        : {}),
    });
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
      ...phaseInfo.warnings,
      ...signalPolicy.warnings,
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
      phaseFamily: phaseInfo.phaseFamily,
      ...(phaseInfo.phase ? { phase: phaseInfo.phase } : {}),
      ...(phaseInfo.phaseLabel ? { phaseLabel: phaseInfo.phaseLabel } : {}),
      phaseConfidence: phaseInfo.confidence,
      isGammaPhase: phaseInfo.isGammaPhase,
      isVanilla: structure.isVanilla,
      isDoppler: phaseInfo.isDoppler,
      isGammaDoppler: phaseInfo.isGammaDoppler,
      patternRelevant: signalPolicy.patternRelevant,
      floatRelevant: signalPolicy.floatRelevant,
      patternSensitivity: signalPolicy.patternSensitivity,
      floatSensitivity: signalPolicy.floatSensitivity,
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
      this.aliasNormalizationService.hasStarPrefix(leadingSegment) ||
      this.aliasNormalizationService.isKnownKnifeWeapon(normalizedWeapon)
    ) {
      return ItemCategory.KNIFE;
    }

    if (/capsule/iu.test(baseName)) {
      return ItemCategory.CAPSULE;
    }

    if (/case/iu.test(baseName)) {
      return ItemCategory.CASE;
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

    const normalizedExterior =
      this.aliasNormalizationService.extractExteriorFromTitle(strippedName);

    return {
      baseName: normalizedExterior
        ? this.aliasNormalizationService.normalizeWhitespace(
            strippedName.replace(/\s+\([^)]+\)$/u, ''),
          )
        : strippedName,
      ...(normalizedExterior ? { exterior: normalizedExterior } : {}),
    };
  }

  private parsePhase(input: {
    readonly category: ItemCategory;
    readonly isVanilla: boolean;
    readonly phaseHint: string | null | undefined;
    readonly nameValue: string;
  }): ParsedPhaseInfo {
    const normalizedPhase = this.phaseNormalizationService.normalize(input);

    return {
      phaseFamily: normalizedPhase.family,
      ...(normalizedPhase.phase ? { phase: normalizedPhase.phase } : {}),
      ...(normalizedPhase.phaseLabel
        ? { phaseLabel: normalizedPhase.phaseLabel }
        : {}),
      isDoppler: normalizedPhase.isDoppler,
      isGammaDoppler: normalizedPhase.isGammaDoppler,
      isGammaPhase: normalizedPhase.isGammaPhase,
      confidence: normalizedPhase.confidence,
      warnings: normalizedPhase.warnings,
    };
  }

  private stripTrailingPhaseSuffix(baseName: string): string {
    const suffixMatch = baseName.match(/\(([^)]+)\)$/u);

    if (
      !suffixMatch?.[1] ||
      !this.aliasNormalizationService.normalizePhaseHint(suffixMatch[1])
    ) {
      return baseName;
    }

    return this.aliasNormalizationService.normalizeWhitespace(
      baseName.replace(/\s+\([^)]+\)$/u, ''),
    );
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
