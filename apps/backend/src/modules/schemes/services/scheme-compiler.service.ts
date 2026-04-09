import { createHash } from 'node:crypto';

import { ItemCategory } from '@prisma/client';
import { BadRequestException, Injectable } from '@nestjs/common';

import {
  OPPORTUNITY_ENGINE_RISK_CLASSES,
  type OpportunityEngineRiskClass,
} from '../../opportunities/domain/opportunity-engine.model';
import {
  SCANNER_ITEM_TIERS,
  type ScannerItemTier,
} from '../../opportunities/domain/item-tier.model';
import {
  SOURCE_ADAPTER_KEYS,
  type SourceAdapterKey,
} from '../../source-adapters/domain/source-adapter.types';
import type {
  SchemeAlertSettingsConfig,
  CompiledScheme,
  SchemeLiveOptionsConfig,
  NormalizedSchemeConfig,
  SchemeDispositionFloor,
  SchemeRecord,
  SchemeScopeConfig,
  SchemeSelectionConfig,
  SchemeSortDirection,
  SchemeSortField,
  SchemeThresholdsConfig,
  SchemeValidationConfig,
  SchemeViewConfig,
} from '../domain/scheme.model';
import {
  SCHEME_DISPOSITION_FLOORS,
  SCHEME_SORT_DIRECTIONS,
  SCHEME_SORT_FIELDS,
} from '../domain/scheme.model';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class SchemeCompilerService {
  compileRecord(record: SchemeRecord): CompiledScheme {
    const normalized = this.normalizeConfig({
      scope: record.scopeJson,
      selection: record.selectionJson,
      thresholds: record.thresholdsJson,
      validation: record.validationJson,
      view: record.viewJson,
      alertSettings: record.alertJson,
      liveOptions: record.liveJson,
    });

    return {
      id: record.id,
      userId: record.userId,
      name: record.name,
      description: record.description,
      status: record.status,
      revision: record.revision,
      originPresetKey: record.originPresetKey,
      feedEnabled: record.feedEnabled,
      liveEnabled: record.liveEnabled,
      alertsEnabled: record.alertsEnabled,
      priority: record.priority,
      configHash: normalized.configHash,
      scope: normalized.scope,
      selection: normalized.selection,
      thresholds: normalized.thresholds,
      validation: normalized.validation,
      view: normalized.view,
      alertSettings: normalized.alertSettings,
      liveOptions: normalized.liveOptions,
      activatedAt: record.activatedAt,
      archivedAt: record.archivedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  normalizeConfig(input: {
    readonly scope: unknown;
    readonly selection: unknown;
    readonly thresholds: unknown;
    readonly validation: unknown;
    readonly view: unknown;
    readonly alertSettings?: unknown;
    readonly liveOptions?: unknown;
  }): NormalizedSchemeConfig {
    const scope = this.normalizeScope(input.scope);
    const selection = this.normalizeSelection(input.selection);
    const thresholds = this.normalizeThresholds(input.thresholds);
    const validation = this.normalizeValidation(input.validation);
    const view = this.normalizeView(input.view);
    const alertSettings = this.normalizeAlertSettings(
      input.alertSettings,
      'alertSettings',
    );
    const liveOptions = this.normalizeLiveOptions(input.liveOptions, 'liveOptions');
    const configHash = this.computeConfigHash({
      scope,
      selection,
      thresholds,
      validation,
      view,
      alertSettings,
      liveOptions,
    });

    return {
      scope,
      selection,
      thresholds,
      validation,
      view,
      alertSettings,
      liveOptions,
      configHash,
    };
  }

  private normalizeScope(input: unknown): SchemeScopeConfig {
    const value = this.readObject(input, 'scope');

    return {
      categories: this.readEnumArray(
        value.categories,
        'scope.categories',
        Object.values(ItemCategory),
      ),
      tiers: this.readEnumArray(value.tiers, 'scope.tiers', SCANNER_ITEM_TIERS),
      itemTypes: this.readStringArray(value.itemTypes, 'scope.itemTypes'),
      itemVariantIds: this.readUuidArray(
        value.itemVariantIds,
        'scope.itemVariantIds',
      ),
    };
  }

  private normalizeSelection(input: unknown): SchemeSelectionConfig {
    const value = this.readObject(input, 'selection');
    const buySources = this.readEnumArray(
      value.buySources,
      'selection.buySources',
      SOURCE_ADAPTER_KEYS,
      { required: true },
    );
    const sellSources = this.readEnumArray(
      value.sellSources,
      'selection.sellSources',
      SOURCE_ADAPTER_KEYS,
      { required: true },
    );

    return {
      buySources,
      sellSources,
      excludedSourcePairs: this.readSourcePairArray(
        value.excludedSourcePairs,
        'selection.excludedSourcePairs',
      ),
    };
  }

  private normalizeThresholds(input: unknown): SchemeThresholdsConfig {
    const value = this.readObject(input, 'thresholds');
    const minBuyCost = this.readOptionalNumber(
      value.minBuyCost,
      'thresholds.minBuyCost',
      0,
    );
    const maxBuyCost = this.readOptionalNumber(
      value.maxBuyCost,
      'thresholds.maxBuyCost',
      0,
    );

    if (
      minBuyCost !== undefined &&
      maxBuyCost !== undefined &&
      minBuyCost > maxBuyCost
    ) {
      throw new BadRequestException(
        'thresholds.minBuyCost cannot be greater than thresholds.maxBuyCost.',
      );
    }

    return {
      minExpectedNetProfit: this.readNumber(
        value.minExpectedNetProfit,
        'thresholds.minExpectedNetProfit',
        0,
        0,
      ),
      minConfidence: this.readNumber(
        value.minConfidence,
        'thresholds.minConfidence',
        0,
        0,
        1,
      ),
      minLiquidity: this.readNumber(
        value.minLiquidity,
        'thresholds.minLiquidity',
        0,
        0,
        1,
      ),
      ...(minBuyCost !== undefined ? { minBuyCost } : {}),
      ...(maxBuyCost !== undefined ? { maxBuyCost } : {}),
      minDisposition: this.readEnum(
        value.minDisposition,
        'thresholds.minDisposition',
        SCHEME_DISPOSITION_FLOORS,
        'candidate',
      ),
      ...(value.maxRiskClass !== undefined
        ? {
            maxRiskClass: this.readEnum(
              value.maxRiskClass,
              'thresholds.maxRiskClass',
              OPPORTUNITY_ENGINE_RISK_CLASSES,
            ),
          }
        : {}),
    };
  }

  private normalizeValidation(input: unknown): SchemeValidationConfig {
    const value = this.readObject(input, 'validation');

    return {
      allowFallbackData: this.readBoolean(
        value.allowFallbackData,
        'validation.allowFallbackData',
        true,
      ),
      allowListedExitOnly: this.readBoolean(
        value.allowListedExitOnly,
        'validation.allowListedExitOnly',
        true,
      ),
      allowRiskyHighUpside: this.readBoolean(
        value.allowRiskyHighUpside,
        'validation.allowRiskyHighUpside',
        true,
      ),
    };
  }

  private normalizeView(input: unknown): SchemeViewConfig {
    const value = this.readObject(input, 'view');

    return {
      defaultSortBy: this.readEnum(
        value.defaultSortBy,
        'view.defaultSortBy',
        SCHEME_SORT_FIELDS,
        'expected_profit',
      ),
      defaultSortDirection: this.readEnum(
        value.defaultSortDirection,
        'view.defaultSortDirection',
        SCHEME_SORT_DIRECTIONS,
        'desc',
      ),
      defaultPageSize: this.readInteger(
        value.defaultPageSize,
        'view.defaultPageSize',
        DEFAULT_PAGE_SIZE,
        1,
        MAX_PAGE_SIZE,
      ),
    };
  }

  private normalizeAlertSettings(
    input: unknown,
    fieldName: string,
  ): SchemeAlertSettingsConfig {
    const value =
      input === undefined || input === null
        ? {}
        : this.readObject(input, fieldName);

    return {
      ...(value.minExpectedNetProfit !== undefined
        ? {
            minExpectedNetProfit: this.readNumber(
              value.minExpectedNetProfit,
              `${fieldName}.minExpectedNetProfit`,
              0,
              0,
            ),
          }
        : {}),
      ...(value.minConfidence !== undefined
        ? {
            minConfidence: this.readNumber(
              value.minConfidence,
              `${fieldName}.minConfidence`,
              0,
              0,
              1,
            ),
          }
        : {}),
      cooldownSeconds: this.readInteger(
        value.cooldownSeconds,
        `${fieldName}.cooldownSeconds`,
        3600,
        0,
        86400,
      ),
      suppressStale: this.readBoolean(
        value.suppressStale,
        `${fieldName}.suppressStale`,
        true,
      ),
      suppressFallback: this.readBoolean(
        value.suppressFallback,
        `${fieldName}.suppressFallback`,
        true,
      ),
    };
  }

  private normalizeLiveOptions(
    input: unknown,
    fieldName: string,
  ): SchemeLiveOptionsConfig {
    const value =
      input === undefined || input === null
        ? {}
        : this.readObject(input, fieldName);

    return {
      freshOnly: this.readBoolean(
        value.freshOnly,
        `${fieldName}.freshOnly`,
        false,
      ),
      maxPairsPerVariant: this.readInteger(
        value.maxPairsPerVariant,
        `${fieldName}.maxPairsPerVariant`,
        32,
        1,
        128,
      ),
      newOnlyWindowSeconds: this.readInteger(
        value.newOnlyWindowSeconds,
        `${fieldName}.newOnlyWindowSeconds`,
        300,
        0,
        86400,
      ),
      dedupeWindowSeconds: this.readInteger(
        value.dedupeWindowSeconds,
        `${fieldName}.dedupeWindowSeconds`,
        60,
        0,
        86400,
      ),
    };
  }

  private computeConfigHash(input: {
    readonly scope: SchemeScopeConfig;
    readonly selection: SchemeSelectionConfig;
    readonly thresholds: SchemeThresholdsConfig;
    readonly validation: SchemeValidationConfig;
    readonly view: SchemeViewConfig;
    readonly alertSettings: SchemeAlertSettingsConfig;
    readonly liveOptions: SchemeLiveOptionsConfig;
  }): string {
    const serialized = this.stableJsonStringify(input);

    return createHash('sha256').update(serialized).digest('hex');
  }

  private readObject(
    value: unknown,
    fieldName: string,
  ): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException(`${fieldName} must be an object.`);
    }

    return value as Record<string, unknown>;
  }

  private readStringArray(
    value: unknown,
    fieldName: string,
  ): readonly string[] {
    if (value === undefined || value === null) {
      return [];
    }

    if (!Array.isArray(value)) {
      throw new BadRequestException(`${fieldName} must be an array.`);
    }

    return [...new Set(value.map((entry, index) => this.readString(entry, `${fieldName}[${index}]`)))];
  }

  private readUuidArray(
    value: unknown,
    fieldName: string,
  ): readonly string[] {
    return this.readStringArray(value, fieldName).map((entry, index) => {
      if (!UUID_PATTERN.test(entry)) {
        throw new BadRequestException(
          `${fieldName}[${index}] must be a valid UUID.`,
        );
      }

      return entry;
    });
  }

  private readSourcePairArray(
    value: unknown,
    fieldName: string,
  ): readonly string[] {
    return this.readStringArray(value, fieldName).map((entry, index) => {
      const [buySource, sellSource, ...rest] = entry.split('->');

      if (
        !buySource ||
        !sellSource ||
        rest.length > 0 ||
        !SOURCE_ADAPTER_KEYS.includes(buySource as SourceAdapterKey) ||
        !SOURCE_ADAPTER_KEYS.includes(sellSource as SourceAdapterKey)
      ) {
        throw new BadRequestException(
          `${fieldName}[${index}] must use '<buySource>-><sellSource>'.`,
        );
      }

      return `${buySource}->${sellSource}`;
    });
  }

  private readString(value: unknown, fieldName: string): string {
    if (typeof value !== 'string') {
      throw new BadRequestException(`${fieldName} must be a string.`);
    }

    const normalized = value.trim();

    if (normalized.length === 0) {
      throw new BadRequestException(`${fieldName} cannot be empty.`);
    }

    return normalized;
  }

  private readEnumArray<T extends string>(
    value: unknown,
    fieldName: string,
    allowedValues: readonly T[],
    options: {
      readonly required?: boolean;
    } = {},
  ): readonly T[] {
    if (value === undefined || value === null) {
      if (options.required) {
        throw new BadRequestException(`${fieldName} is required.`);
      }

      return [];
    }

    if (!Array.isArray(value)) {
      throw new BadRequestException(`${fieldName} must be an array.`);
    }

    if (options.required && value.length === 0) {
      throw new BadRequestException(`${fieldName} cannot be empty.`);
    }

    return [
      ...new Set(
        value.map((entry, index) =>
          this.readEnum(entry, `${fieldName}[${index}]`, allowedValues),
        ),
      ),
    ];
  }

  private readEnum<T extends string>(
    value: unknown,
    fieldName: string,
    allowedValues: readonly T[],
    defaultValue?: T,
  ): T {
    if (value === undefined || value === null) {
      if (defaultValue !== undefined) {
        return defaultValue;
      }

      throw new BadRequestException(`${fieldName} is required.`);
    }

    if (
      typeof value !== 'string' ||
      !allowedValues.includes(value as T)
    ) {
      throw new BadRequestException(
        `${fieldName} must be one of: ${allowedValues.join(', ')}.`,
      );
    }

    return value as T;
  }

  private readNumber(
    value: unknown,
    fieldName: string,
    defaultValue: number,
    min?: number,
    max?: number,
  ): number {
    if (value === undefined || value === null) {
      return defaultValue;
    }

    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new BadRequestException(`${fieldName} must be a number.`);
    }

    if (min !== undefined && value < min) {
      throw new BadRequestException(`${fieldName} must be >= ${min}.`);
    }

    if (max !== undefined && value > max) {
      throw new BadRequestException(`${fieldName} must be <= ${max}.`);
    }

    return Number(value.toFixed(4));
  }

  private readOptionalNumber(
    value: unknown,
    fieldName: string,
    min?: number,
    max?: number,
  ): number | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    return this.readNumber(value, fieldName, 0, min, max);
  }

  private readInteger(
    value: unknown,
    fieldName: string,
    defaultValue: number,
    min?: number,
    max?: number,
  ): number {
    if (value === undefined || value === null) {
      return defaultValue;
    }

    if (!Number.isInteger(value)) {
      throw new BadRequestException(`${fieldName} must be an integer.`);
    }

    return this.readNumber(value, fieldName, defaultValue, min, max);
  }

  private readBoolean(
    value: unknown,
    fieldName: string,
    defaultValue: boolean,
  ): boolean {
    if (value === undefined || value === null) {
      return defaultValue;
    }

    if (typeof value !== 'boolean') {
      throw new BadRequestException(`${fieldName} must be a boolean.`);
    }

    return value;
  }

  private stableJsonStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
      return `[${value.map((entry) => this.stableJsonStringify(entry)).join(',')}]`;
    }

    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([leftKey], [rightKey]) => leftKey.localeCompare(rightKey),
    );

    return `{${entries
      .map(
        ([key, entryValue]) =>
          `${JSON.stringify(key)}:${this.stableJsonStringify(entryValue)}`,
      )
      .join(',')}}`;
  }
}
