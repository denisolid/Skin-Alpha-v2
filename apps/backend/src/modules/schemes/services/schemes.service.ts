import { SchemeStatus, type Prisma } from '@prisma/client';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { AuthUserRecord } from '../../auth/domain/auth.repository';
import type { SchemesUseCase } from '../application/schemes.use-case';
import type { CompiledScheme, SchemeRecord } from '../domain/scheme.model';
import {
  SCHEMES_REPOSITORY,
  type SchemesRepository,
} from '../domain/schemes.repository';
import type { CreateSchemeDto } from '../dto/create-scheme.dto';
import type { DuplicateSchemeDto } from '../dto/duplicate-scheme.dto';
import type {
  SchemeDetailDto,
  SchemesListDto,
  SchemeSummaryDto,
} from '../dto/scheme.dto';
import type { UpdateSchemeDto } from '../dto/update-scheme.dto';
import {
  SCHEME_PRESETS_BY_KEY,
  type SchemePresetDefinition,
} from '../domain/scheme-presets';
import { SchemeCompilerService } from './scheme-compiler.service';

@Injectable()
export class SchemesService implements SchemesUseCase {
  constructor(
    @Inject(SCHEMES_REPOSITORY)
    private readonly schemesRepository: SchemesRepository,
    @Inject(SchemeCompilerService)
    private readonly schemeCompilerService: SchemeCompilerService,
  ) {}

  async getSchemes(
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<SchemesListDto> {
    const schemes = await this.schemesRepository.findSchemesByUser(user.id);

    return {
      items: schemes.map((scheme) => this.toSummaryDto(scheme)),
    };
  }

  async getScheme(
    schemeId: string,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<SchemeDetailDto> {
    const scheme = await this.getRequiredSchemeRecord(schemeId, user.id);

    return this.toDetailDto(this.schemeCompilerService.compileRecord(scheme));
  }

  async createScheme(
    input: CreateSchemeDto,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<SchemeDetailDto> {
    const preset = this.resolvePreset(input.originPresetKey);
    const normalizedConfig = this.buildCreateConfig(input, preset);
    const scheme = await this.schemesRepository.createScheme({
      userId: user.id,
      name: input.name.trim(),
      ...(input.description !== undefined
        ? { description: this.normalizeNullableText(input.description) }
        : {}),
      ...(preset
        ? { originPresetKey: preset.key }
        : {}),
      feedEnabled: input.feedEnabled ?? true,
      liveEnabled: input.liveEnabled ?? false,
      alertsEnabled: input.alertsEnabled ?? false,
      priority: input.priority ?? 0,
      configHash: normalizedConfig.configHash,
      scopeJson: this.toJsonValue(normalizedConfig.scope),
      selectionJson: this.toJsonValue(normalizedConfig.selection),
      thresholdsJson: this.toJsonValue(normalizedConfig.thresholds),
      validationJson: this.toJsonValue(normalizedConfig.validation),
      viewJson: this.toJsonValue(normalizedConfig.view),
      alertJson: this.toJsonValue(normalizedConfig.alertSettings),
      liveJson: this.toJsonValue(normalizedConfig.liveOptions),
    });

    return this.toDetailDto(this.schemeCompilerService.compileRecord(scheme));
  }

  async updateScheme(
    schemeId: string,
    input: UpdateSchemeDto,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<SchemeDetailDto> {
    const existing = await this.getRequiredSchemeRecord(schemeId, user.id);
    this.assertMutableScheme(existing, 'updated');
    const normalizedConfig = this.buildUpdatedConfig(existing, input);
    const updated = await this.schemesRepository.updateScheme({
      userId: user.id,
      schemeId,
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined
        ? { description: this.normalizeNullableText(input.description) }
        : {}),
      ...(input.feedEnabled !== undefined
        ? { feedEnabled: input.feedEnabled }
        : {}),
      ...(input.liveEnabled !== undefined
        ? { liveEnabled: input.liveEnabled }
        : {}),
      ...(input.alertsEnabled !== undefined
        ? { alertsEnabled: input.alertsEnabled }
        : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      configHash: normalizedConfig.configHash,
      scopeJson: this.toJsonValue(normalizedConfig.scope),
      selectionJson: this.toJsonValue(normalizedConfig.selection),
      thresholdsJson: this.toJsonValue(normalizedConfig.thresholds),
      validationJson: this.toJsonValue(normalizedConfig.validation),
      viewJson: this.toJsonValue(normalizedConfig.view),
      alertJson: this.toJsonValue(normalizedConfig.alertSettings),
      liveJson: this.toJsonValue(normalizedConfig.liveOptions),
    });

    if (!updated) {
      throw new NotFoundException(`Scheme '${schemeId}' was not found.`);
    }

    return this.toDetailDto(this.schemeCompilerService.compileRecord(updated));
  }

  async activateScheme(
    schemeId: string,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<SchemeDetailDto> {
    const existing = await this.getRequiredSchemeRecord(schemeId, user.id);
    this.assertActivatableScheme(existing);
    const compiled = this.schemeCompilerService.compileRecord(existing);

    if (existing.status === SchemeStatus.ACTIVE) {
      return this.toDetailDto(compiled);
    }

    const updated = await this.schemesRepository.updateSchemeStatus({
      userId: user.id,
      schemeId,
      status: SchemeStatus.ACTIVE,
      activatedAt: new Date(),
      archivedAt: null,
    });

    if (!updated) {
      throw new NotFoundException(`Scheme '${schemeId}' was not found.`);
    }

    return this.toDetailDto(this.schemeCompilerService.compileRecord(updated));
  }

  async deactivateScheme(
    schemeId: string,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<SchemeDetailDto> {
    const existing = await this.getRequiredSchemeRecord(schemeId, user.id);
    this.assertMutableScheme(existing, 'deactivated');

    if (existing.status === SchemeStatus.PAUSED) {
      return this.toDetailDto(this.schemeCompilerService.compileRecord(existing));
    }

    const updated = await this.schemesRepository.updateSchemeStatus({
      userId: user.id,
      schemeId,
      status: SchemeStatus.PAUSED,
    });

    if (!updated) {
      throw new NotFoundException(`Scheme '${schemeId}' was not found.`);
    }

    return this.toDetailDto(this.schemeCompilerService.compileRecord(updated));
  }

  async archiveScheme(
    schemeId: string,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<void> {
    const existing = await this.getRequiredSchemeRecord(schemeId, user.id);

    if (existing.status === SchemeStatus.ARCHIVED) {
      return;
    }

    const updated = await this.schemesRepository.updateSchemeStatus({
      userId: user.id,
      schemeId,
      status: SchemeStatus.ARCHIVED,
      feedEnabled: false,
      liveEnabled: false,
      alertsEnabled: false,
      archivedAt: new Date(),
      activatedAt: null,
    });

    if (!updated) {
      throw new NotFoundException(`Scheme '${schemeId}' was not found.`);
    }
  }

  async duplicateScheme(
    schemeId: string,
    input: DuplicateSchemeDto = {},
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<SchemeDetailDto> {
    const existing = await this.getRequiredCompiledScheme(schemeId, user.id);
    const duplicated = await this.schemesRepository.createScheme({
      userId: user.id,
      name: input.name?.trim() || `${existing.name} Copy`,
      ...(existing.description ? { description: existing.description } : {}),
      ...(existing.originPresetKey
        ? { originPresetKey: existing.originPresetKey }
        : {}),
      feedEnabled: existing.feedEnabled,
      liveEnabled: existing.liveEnabled,
      alertsEnabled: existing.alertsEnabled,
      priority: existing.priority,
      configHash: existing.configHash,
      scopeJson: this.toJsonValue(existing.scope),
      selectionJson: this.toJsonValue(existing.selection),
      thresholdsJson: this.toJsonValue(existing.thresholds),
      validationJson: this.toJsonValue(existing.validation),
      viewJson: this.toJsonValue(existing.view),
      alertJson: this.toJsonValue(existing.alertSettings),
      liveJson: this.toJsonValue(existing.liveOptions),
    });

    if (input.activate) {
      const activated = await this.schemesRepository.updateSchemeStatus({
        userId: user.id,
        schemeId: duplicated.id,
        status: SchemeStatus.ACTIVE,
        activatedAt: new Date(),
      });

      if (!activated) {
        throw new NotFoundException(`Scheme '${duplicated.id}' was not found.`);
      }

      return this.toDetailDto(this.schemeCompilerService.compileRecord(activated));
    }

    return this.toDetailDto(this.schemeCompilerService.compileRecord(duplicated));
  }

  async getCompiledScheme(
    schemeId: string,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<CompiledScheme> {
    return this.getRequiredCompiledScheme(schemeId, user.id);
  }

  async listActiveCompiledSchemes(
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<readonly CompiledScheme[]> {
    const schemes = await this.schemesRepository.findSchemesByUser(user.id);

    return schemes
      .filter((scheme) => scheme.status === SchemeStatus.ACTIVE)
      .map((scheme) => this.schemeCompilerService.compileRecord(scheme));
  }

  private async getRequiredSchemeRecord(
    schemeId: string,
    userId: string,
  ): Promise<SchemeRecord> {
    const scheme = await this.schemesRepository.findSchemeById(userId, schemeId);

    if (!scheme) {
      throw new NotFoundException(`Scheme '${schemeId}' was not found.`);
    }

    return scheme;
  }

  private async getRequiredCompiledScheme(
    schemeId: string,
    userId: string,
  ): Promise<CompiledScheme> {
    const scheme = await this.getRequiredSchemeRecord(schemeId, userId);

    return this.schemeCompilerService.compileRecord(scheme);
  }

  private buildCreateConfig(
    input: CreateSchemeDto,
    preset?: SchemePresetDefinition,
  ) {
    const scope = this.mergeRawConfigBlock(preset?.scope, input.scope);
    const selection = this.mergeRawConfigBlock(preset?.selection, input.selection);
    const thresholds = this.mergeRawConfigBlock(
      preset?.thresholds,
      input.thresholds,
    );
    const validation = this.mergeRawConfigBlock(
      preset?.validation,
      input.validation,
    );
    const view = this.mergeRawConfigBlock(preset?.view, input.view);
    const alertSettings = this.mergeRawConfigBlock(
      preset?.alertSettings,
      input.alertSettings,
    );
    const liveOptions = this.mergeRawConfigBlock(
      preset?.liveOptions,
      input.liveOptions,
    );

    if (!scope || !selection || !thresholds || !validation || !view) {
      throw new BadRequestException(
        'scope, selection, thresholds, validation, and view are required unless provided by a known preset.',
      );
    }

    return this.schemeCompilerService.normalizeConfig({
      scope,
      selection,
      thresholds,
      validation,
      view,
      alertSettings,
      liveOptions,
    });
  }

  private buildUpdatedConfig(existing: SchemeRecord, input: UpdateSchemeDto) {
    return this.schemeCompilerService.normalizeConfig({
      scope: this.mergeRawConfigBlock(existing.scopeJson, input.scope),
      selection: this.mergeRawConfigBlock(
        existing.selectionJson,
        input.selection,
      ),
      thresholds: this.mergeRawConfigBlock(
        existing.thresholdsJson,
        input.thresholds,
      ),
      validation: this.mergeRawConfigBlock(
        existing.validationJson,
        input.validation,
      ),
      view: this.mergeRawConfigBlock(existing.viewJson, input.view),
      alertSettings: this.mergeRawConfigBlock(
        existing.alertJson,
        input.alertSettings,
      ),
      liveOptions: this.mergeRawConfigBlock(existing.liveJson, input.liveOptions),
    });
  }

  private mergeRawConfigBlock(
    baseValue: unknown,
    overrideValue: unknown,
  ): unknown {
    if (baseValue === undefined || baseValue === null) {
      return overrideValue;
    }

    if (overrideValue === undefined || overrideValue === null) {
      return baseValue;
    }

    if (
      Array.isArray(baseValue) ||
      Array.isArray(overrideValue) ||
      typeof baseValue !== 'object' ||
      typeof overrideValue !== 'object'
    ) {
      return overrideValue;
    }

    const merged: Record<string, unknown> = {
      ...(baseValue as Record<string, unknown>),
    };

    for (const [key, value] of Object.entries(
      overrideValue as Record<string, unknown>,
    )) {
      merged[key] = this.mergeRawConfigBlock(merged[key], value);
    }

    return merged;
  }

  private resolvePreset(
    originPresetKey: string | undefined,
  ): SchemePresetDefinition | undefined {
    if (!originPresetKey) {
      return undefined;
    }

    const preset = SCHEME_PRESETS_BY_KEY.get(originPresetKey.trim());

    if (!preset) {
      throw new BadRequestException(
        `Unknown scheme preset '${originPresetKey}'.`,
      );
    }

    return preset;
  }

  private assertMutableScheme(
    scheme: Pick<SchemeRecord, 'id' | 'status'>,
    action: string,
  ): void {
    if (scheme.status === SchemeStatus.ARCHIVED) {
      throw new BadRequestException(
        `Archived scheme '${scheme.id}' cannot be ${action}.`,
      );
    }
  }

  private assertActivatableScheme(
    scheme: Pick<SchemeRecord, 'id' | 'status'>,
  ): void {
    if (scheme.status === SchemeStatus.ARCHIVED) {
      throw new BadRequestException(
        `Archived scheme '${scheme.id}' cannot be activated.`,
      );
    }
  }

  private toSummaryDto(
    scheme: Pick<
      SchemeRecord,
      | 'id'
      | 'name'
      | 'description'
      | 'status'
      | 'revision'
      | 'feedEnabled'
      | 'liveEnabled'
      | 'alertsEnabled'
      | 'priority'
      | 'updatedAt'
    >,
  ): SchemeSummaryDto {
    return {
      id: scheme.id,
      name: scheme.name,
      ...(scheme.description ? { description: scheme.description } : {}),
      status: scheme.status,
      revision: scheme.revision,
      feedEnabled: scheme.feedEnabled,
      liveEnabled: scheme.liveEnabled,
      alertsEnabled: scheme.alertsEnabled,
      priority: scheme.priority,
      updatedAt: scheme.updatedAt,
    };
  }

  private toDetailDto(scheme: CompiledScheme): SchemeDetailDto {
    return {
      ...this.toSummaryDto(scheme),
      ...(scheme.originPresetKey
        ? { originPresetKey: scheme.originPresetKey }
        : {}),
      configHash: scheme.configHash,
      scope: this.toRecord(scheme.scope),
      selection: this.toRecord(scheme.selection),
      thresholds: this.toRecord(scheme.thresholds),
      validation: this.toRecord(scheme.validation),
      view: this.toRecord(scheme.view),
      alertSettings: scheme.alertSettings,
      liveOptions: scheme.liveOptions,
      ...(scheme.activatedAt ? { activatedAt: scheme.activatedAt } : {}),
      ...(scheme.archivedAt ? { archivedAt: scheme.archivedAt } : {}),
      createdAt: scheme.createdAt,
    };
  }

  private normalizeNullableText(value: string): string | null {
    const normalized = value.trim();

    return normalized.length > 0 ? normalized : null;
  }

  private toJsonValue(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private toRecord(value: unknown): Record<string, unknown> {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  }
}
