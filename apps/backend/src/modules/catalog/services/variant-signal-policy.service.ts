import { ItemCategory } from '@prisma/client';
import { Injectable } from '@nestjs/common';

import type { VariantSignalPolicyModel } from '../domain/variant-signal-policy.model';

@Injectable()
export class VariantSignalPolicyService {
  resolve(input: {
    readonly category: ItemCategory;
    readonly nameValue: string;
    readonly isVanilla: boolean;
    readonly exterior?: string | undefined;
    readonly paintIndex?: number | null | undefined;
  }): VariantSignalPolicyModel {
    if (input.isVanilla) {
      return {
        patternRelevant: false,
        floatRelevant: false,
        patternSensitivity: 'none',
        floatSensitivity: 'none',
        warnings: [],
      };
    }

    const normalizedName = input.nameValue.toLowerCase();
    const patternRequired =
      input.paintIndex === 44 ||
      input.paintIndex === 1004 ||
      /case hardened|crimson web/iu.test(normalizedName);
    const patternSupported =
      patternRequired || /fade/iu.test(normalizedName);
    const floatRequired =
      input.category === ItemCategory.KNIFE ||
      input.category === ItemCategory.GLOVE;
    const floatSupported =
      floatRequired ||
      (input.category === ItemCategory.SKIN && Boolean(input.exterior));

    return {
      patternRelevant: patternSupported,
      floatRelevant: floatSupported,
      patternSensitivity: patternRequired
        ? 'required'
        : patternSupported
          ? 'supported'
          : 'none',
      floatSensitivity: floatRequired
        ? 'required'
        : floatSupported
          ? 'supported'
          : 'none',
      warnings: [],
    };
  }
}
