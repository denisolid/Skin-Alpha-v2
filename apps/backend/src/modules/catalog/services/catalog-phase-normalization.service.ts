import { VariantPhase, type ItemCategory } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import type {
  CatalogPhaseFamily,
  CatalogPhaseNormalizationResult,
} from '../domain/catalog-phase.model';
import { CatalogAliasNormalizationService } from './catalog-alias-normalization.service';

@Injectable()
export class CatalogPhaseNormalizationService {
  constructor(
    @Inject(CatalogAliasNormalizationService)
    private readonly aliasNormalizationService: CatalogAliasNormalizationService,
  ) {}

  normalize(input: {
    readonly category: ItemCategory;
    readonly isVanilla: boolean;
    readonly phaseHint?: string | null | undefined;
    readonly nameValue: string;
  }): CatalogPhaseNormalizationResult {
    if (input.isVanilla) {
      return {
        family: 'vanilla',
        isDoppler: false,
        isGammaDoppler: false,
        isGammaPhase: false,
        confidence: 1,
        warnings: [],
      };
    }

    const normalizedNameValue = this.aliasNormalizationService
      .normalizeMarketHashName(input.nameValue)
      .toLowerCase();
    const normalizedPhaseHint = input.phaseHint
      ? this.aliasNormalizationService
          .normalizeMarketHashName(input.phaseHint)
          .toLowerCase()
      : '';
    const combinedContext = `${normalizedPhaseHint} ${normalizedNameValue}`.trim();
    const hintLabel =
      this.aliasNormalizationService.normalizePhaseHint(input.phaseHint);
    const titleLabel =
      this.aliasNormalizationService.normalizePhaseHint(input.nameValue);
    const hasGammaContext = /\bgamma\s*doppler\b/iu.test(combinedContext);
    const hasDopplerContext =
      hasGammaContext || /\bdoppler\b/iu.test(combinedContext);
    const warnings: string[] = [];
    const phaseLabel = hintLabel ?? titleLabel;

    if (hintLabel && titleLabel && hintLabel !== titleLabel) {
      warnings.push(
        `Phase hint '${hintLabel}' conflicts with title-derived phase '${titleLabel}'.`,
      );
    }

    if (!phaseLabel) {
      if (
        (input.category === 'KNIFE' || input.category === 'GLOVE') &&
        hasDopplerContext
      ) {
        warnings.push(
          'Doppler-family title did not resolve to a stable canonical phase.',
        );
      }

      return {
        family: hasGammaContext
          ? 'gamma-doppler'
          : hasDopplerContext
            ? 'doppler'
            : 'standard',
        isDoppler: hasDopplerContext,
        isGammaDoppler: hasGammaContext,
        isGammaPhase: false,
        confidence: hasDopplerContext ? 0.62 : 1,
        warnings,
      };
    }

    const mappedPhase = this.mapPhaseLabel(phaseLabel);
    const family = this.resolvePhaseFamily({
      phaseLabel,
      hasGammaContext,
      hasDopplerContext,
    });
    const confidence =
      hintLabel && titleLabel && hintLabel === titleLabel
        ? 0.99
        : hintLabel
          ? 0.94
          : titleLabel
            ? 0.86
            : 0.72;

    if (
      phaseLabel === 'Emerald' &&
      family !== 'gamma-doppler'
    ) {
      warnings.push(
        'Emerald phase was detected without Gamma Doppler context.',
      );
    }

    if (
      (phaseLabel === 'Ruby' ||
        phaseLabel === 'Sapphire' ||
        phaseLabel === 'Black Pearl') &&
      family === 'standard'
    ) {
      warnings.push(
        `Special phase '${phaseLabel}' was detected without Doppler context.`,
      );
    }

    return {
      family,
      ...(mappedPhase ? { phase: mappedPhase } : {}),
      phaseLabel,
      isDoppler: family === 'doppler' || family === 'gamma-doppler',
      isGammaDoppler: family === 'gamma-doppler',
      isGammaPhase: family === 'gamma-doppler',
      confidence: Number(confidence.toFixed(4)),
      warnings,
    };
  }

  private resolvePhaseFamily(input: {
    readonly phaseLabel: string;
    readonly hasGammaContext: boolean;
    readonly hasDopplerContext: boolean;
  }): CatalogPhaseFamily {
    if (input.hasGammaContext || input.phaseLabel === 'Emerald') {
      return 'gamma-doppler';
    }

    if (
      input.hasDopplerContext ||
      input.phaseLabel === 'Ruby' ||
      input.phaseLabel === 'Sapphire' ||
      input.phaseLabel === 'Black Pearl' ||
      input.phaseLabel.startsWith('Phase ')
    ) {
      return 'doppler';
    }

    return 'standard';
  }

  private mapPhaseLabel(phaseLabel: string): VariantPhase | undefined {
    switch (phaseLabel) {
      case 'Phase 1':
        return VariantPhase.PHASE_1;
      case 'Phase 2':
        return VariantPhase.PHASE_2;
      case 'Phase 3':
        return VariantPhase.PHASE_3;
      case 'Phase 4':
        return VariantPhase.PHASE_4;
      case 'Ruby':
        return VariantPhase.RUBY;
      case 'Sapphire':
        return VariantPhase.SAPPHIRE;
      case 'Black Pearl':
        return VariantPhase.BLACK_PEARL;
      case 'Emerald':
        return VariantPhase.EMERALD;
      default:
        return undefined;
    }
  }
}
