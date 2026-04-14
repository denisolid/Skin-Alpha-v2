import { Prisma } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  chunkArray,
  mapWithConcurrencyLimit,
} from '../../shared/utils/async.util';
import { createModuleSkeletonStatus } from '../../shared/module-skeleton.types';
import type { CatalogItemMappingDto } from '../dto/catalog-item-mapping.dto';
import type {
  CatalogPersistAction,
  CatalogRepository,
  PersistCatalogMappingInput,
  PersistedCatalogMapping,
} from '../domain/catalog.repository';
import { slugify } from './utils/slugify.util';

const CATALOG_PREFETCH_CHUNK_SIZE = 1_000;
const CATALOG_CREATE_CHUNK_SIZE = 250;
const CATALOG_UPDATE_CONCURRENCY = 4;

type CanonicalItemRecord = Awaited<
  ReturnType<Prisma.TransactionClient['canonicalItem']['findUnique']>
> extends infer T
  ? Exclude<T, null>
  : never;
type ItemVariantRecord = Awaited<
  ReturnType<Prisma.TransactionClient['itemVariant']['findUnique']>
> extends infer T
  ? Exclude<T, null>
  : never;

interface CanonicalMappingGroup {
  lastMapping: CatalogItemMappingDto;
  sources: Set<string>;
  statTrakSupported: boolean;
  souvenirSupported: boolean;
}

interface VariantMappingGroup {
  canonicalItemId: string;
  lastMapping: CatalogItemMappingDto;
  marketHashNames: Set<string>;
  sources: Set<string>;
}

@Injectable()
export class CatalogRepositoryAdapter implements CatalogRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
  ) {}

  getModuleSkeleton() {
    return createModuleSkeletonStatus('catalog');
  }

  async upsertResolvedMapping(
    input: PersistCatalogMappingInput,
  ): Promise<PersistedCatalogMapping> {
    const [persistedMapping] = await this.upsertResolvedMappings([input]);

    if (!persistedMapping) {
      throw new Error(
        `Catalog repository unexpectedly returned no persisted mapping for ${input.mapping.marketHashName}.`,
      );
    }

    return persistedMapping;
  }

  async upsertResolvedMappings(
    inputs: readonly PersistCatalogMappingInput[],
  ): Promise<readonly PersistedCatalogMapping[]> {
    if (inputs.length === 0) {
      return [];
    }

    const canonicalGroups = this.groupCanonicalMappings(inputs);
    const canonicalSlugs = [...canonicalGroups.keys()];
    const canonicalItemsBefore =
      await this.findCanonicalItemsBySlug(canonicalSlugs);

    await this.createMissingCanonicalItems(canonicalGroups, canonicalItemsBefore);

    const canonicalItemsAfterCreate =
      await this.findCanonicalItemsBySlug(canonicalSlugs);
    const canonicalItemsBySlug = new Map<string, CanonicalItemRecord>();
    const canonicalActionsBySlug = new Map<string, CatalogPersistAction>();
    const canonicalUpdates: Array<{
      readonly slug: string;
      readonly itemId: string;
      readonly data: Prisma.CanonicalItemUpdateInput;
    }> = [];

    for (const [slug, group] of canonicalGroups.entries()) {
      const canonicalItem = canonicalItemsAfterCreate.get(slug);

      if (!canonicalItem) {
        throw new Error(
          `Canonical item "${slug}" was not found after catalog upsert.`,
        );
      }

      const desiredCanonicalData = this.buildCanonicalItemData(
        canonicalItem,
        group,
      );
      const hasChanges = this.hasCanonicalItemChanges(
        canonicalItem,
        desiredCanonicalData,
      );
      const existedBefore = canonicalItemsBefore.has(slug);

      canonicalItemsBySlug.set(slug, canonicalItem);
      canonicalActionsBySlug.set(
        slug,
        !existedBefore ? 'created' : hasChanges ? 'updated' : 'existingMatched',
      );

      if (hasChanges) {
        canonicalUpdates.push({
          slug,
          itemId: canonicalItem.id,
          data: desiredCanonicalData,
        });
      }
    }

    await mapWithConcurrencyLimit(
      canonicalUpdates,
      CATALOG_UPDATE_CONCURRENCY,
      async (update) => {
        const updatedCanonicalItem = await this.prismaService.canonicalItem.update({
          where: {
            id: update.itemId,
          },
          data: update.data,
        });

        canonicalItemsBySlug.set(update.slug, updatedCanonicalItem);
      },
    );

    const variantGroups = this.groupVariantMappings(inputs, canonicalItemsBySlug);
    const canonicalItemIds = [
      ...new Set(
        [...variantGroups.values()].map((variantGroup) => variantGroup.canonicalItemId),
      ),
    ];
    const itemVariantsBefore =
      await this.findItemVariantsByCanonicalItemIds(canonicalItemIds);
    const matchedVariantsBefore = new Map<string, ItemVariantRecord>();

    for (const [groupKey, group] of variantGroups.entries()) {
      const matchedVariant = this.resolveExistingVariant(
        itemVariantsBefore,
        group.canonicalItemId,
        group.lastMapping,
      );

      if (matchedVariant) {
        matchedVariantsBefore.set(groupKey, matchedVariant);
      }
    }

    await this.createMissingItemVariants(variantGroups, matchedVariantsBefore);

    const itemVariantsAfterCreate =
      await this.findItemVariantsByCanonicalItemIds(canonicalItemIds);
    const matchedVariantsByGroupKey = new Map<string, ItemVariantRecord>();
    const variantActionsByGroupKey = new Map<string, CatalogPersistAction>();
    const itemVariantUpdates: Array<{
      readonly groupKey: string;
      readonly itemVariantId: string;
      readonly data: Prisma.ItemVariantUpdateInput;
    }> = [];

    for (const [groupKey, group] of variantGroups.entries()) {
      const existingVariant =
        this.resolveExistingVariant(
          itemVariantsAfterCreate,
          group.canonicalItemId,
          group.lastMapping,
        ) ??
        matchedVariantsBefore.get(groupKey);

      if (!existingVariant) {
        throw new Error(
          `Item variant "${group.lastMapping.variantKey}" was not found after catalog upsert.`,
        );
      }

      const desiredVariantData = this.buildItemVariantData(existingVariant, group);
      const hasChanges = this.hasItemVariantChanges(
        existingVariant,
        desiredVariantData,
      );
      const existedBefore = matchedVariantsBefore.has(groupKey);

      matchedVariantsByGroupKey.set(groupKey, existingVariant);
      variantActionsByGroupKey.set(
        groupKey,
        !existedBefore ? 'created' : hasChanges ? 'updated' : 'existingMatched',
      );

      if (hasChanges) {
        itemVariantUpdates.push({
          groupKey,
          itemVariantId: existingVariant.id,
          data: desiredVariantData,
        });
      }
    }

    await mapWithConcurrencyLimit(
      itemVariantUpdates,
      CATALOG_UPDATE_CONCURRENCY,
      async (update) => {
        const updatedItemVariant = await this.prismaService.itemVariant.update({
          where: {
            id: update.itemVariantId,
          },
          data: update.data,
        });

        matchedVariantsByGroupKey.set(update.groupKey, updatedItemVariant);
      },
    );

    return inputs.map((input) => {
      const canonicalItem = canonicalItemsBySlug.get(input.mapping.canonicalSlug);

      if (!canonicalItem) {
        throw new Error(
          `Canonical item "${input.mapping.canonicalSlug}" was not resolved for ${input.mapping.marketHashName}.`,
        );
      }

      const variantGroupKey = this.buildVariantIdentityKey(
        canonicalItem.id,
        input.mapping.variantKey,
      );
      const itemVariant = matchedVariantsByGroupKey.get(variantGroupKey);

      if (!itemVariant) {
        throw new Error(
          `Item variant "${input.mapping.variantKey}" was not resolved for ${input.mapping.marketHashName}.`,
        );
      }

      return {
        canonicalItemId: canonicalItem.id,
        itemVariantId: itemVariant.id,
        category: canonicalItem.category,
        canonicalItemAction:
          canonicalActionsBySlug.get(input.mapping.canonicalSlug) ??
          'existingMatched',
        itemVariantAction:
          variantActionsByGroupKey.get(variantGroupKey) ?? 'existingMatched',
      } satisfies PersistedCatalogMapping;
    });
  }

  private groupCanonicalMappings(
    inputs: readonly PersistCatalogMappingInput[],
  ): ReadonlyMap<string, CanonicalMappingGroup> {
    const groups = new Map<string, CanonicalMappingGroup>();

    for (const input of inputs) {
      const currentGroup = groups.get(input.mapping.canonicalSlug);

      if (currentGroup) {
        currentGroup.lastMapping = input.mapping;
        currentGroup.sources.add(input.source);
        currentGroup.statTrakSupported =
          currentGroup.statTrakSupported || input.mapping.stattrak;
        currentGroup.souvenirSupported =
          currentGroup.souvenirSupported || input.mapping.souvenir;
        continue;
      }

      groups.set(input.mapping.canonicalSlug, {
        lastMapping: input.mapping,
        sources: new Set([input.source]),
        statTrakSupported: input.mapping.stattrak,
        souvenirSupported: input.mapping.souvenir,
      });
    }

    return groups;
  }

  private groupVariantMappings(
    inputs: readonly PersistCatalogMappingInput[],
    canonicalItemsBySlug: ReadonlyMap<string, CanonicalItemRecord>,
  ): ReadonlyMap<string, VariantMappingGroup> {
    const groups = new Map<string, VariantMappingGroup>();

    for (const input of inputs) {
      const canonicalItem = canonicalItemsBySlug.get(input.mapping.canonicalSlug);

      if (!canonicalItem) {
        throw new Error(
          `Canonical item "${input.mapping.canonicalSlug}" was missing while grouping variants.`,
        );
      }

      const groupKey = this.buildVariantIdentityKey(
        canonicalItem.id,
        input.mapping.variantKey,
      );
      const currentGroup = groups.get(groupKey);

      if (currentGroup) {
        currentGroup.lastMapping = input.mapping;
        currentGroup.marketHashNames.add(input.mapping.marketHashName);
        currentGroup.sources.add(input.source);
        continue;
      }

      groups.set(groupKey, {
        canonicalItemId: canonicalItem.id,
        lastMapping: input.mapping,
        marketHashNames: new Set([input.mapping.marketHashName]),
        sources: new Set([input.source]),
      });
    }

    return groups;
  }

  private async findCanonicalItemsBySlug(
    canonicalSlugs: readonly string[],
  ): Promise<ReadonlyMap<string, CanonicalItemRecord>> {
    const chunks = chunkArray(
      [...new Set(canonicalSlugs)],
      CATALOG_PREFETCH_CHUNK_SIZE,
    );
    const records = (
      await Promise.all(
        chunks.map((slugChunk) =>
          this.prismaService.canonicalItem.findMany({
            where: {
              slug: {
                in: slugChunk,
              },
            },
          }),
        ),
      )
    ).flat();

    return new Map(records.map((record) => [record.slug, record]));
  }

  private async createMissingCanonicalItems(
    canonicalGroups: ReadonlyMap<string, CanonicalMappingGroup>,
    existingCanonicalItems: ReadonlyMap<string, CanonicalItemRecord>,
  ): Promise<void> {
    const missingRows = [...canonicalGroups.entries()]
      .filter(([slug]) => !existingCanonicalItems.has(slug))
      .map(([slug, group]) => ({
        slug,
        ...this.toCanonicalItemCreateInput(group),
      }));
    const chunks = chunkArray(missingRows, CATALOG_CREATE_CHUNK_SIZE);

    for (const chunk of chunks) {
      await this.prismaService.canonicalItem.createMany({
        data: chunk,
        skipDuplicates: true,
      });
    }
  }

  private async findItemVariantsByCanonicalItemIds(
    canonicalItemIds: readonly string[],
  ): Promise<ReadonlyMap<string, ItemVariantRecord>> {
    if (canonicalItemIds.length === 0) {
      return new Map();
    }

    const chunks = chunkArray(
      [...new Set(canonicalItemIds)],
      CATALOG_PREFETCH_CHUNK_SIZE,
    );
    const records = (
      await Promise.all(
        chunks.map((canonicalItemIdChunk) =>
          this.prismaService.itemVariant.findMany({
            where: {
              canonicalItemId: {
                in: canonicalItemIdChunk,
              },
            },
          }),
        ),
      )
    ).flat();

    return new Map(
      records.map((record) => [
        this.buildVariantIdentityKey(record.canonicalItemId, record.variantKey),
        record,
      ]),
    );
  }

  private async createMissingItemVariants(
    variantGroups: ReadonlyMap<string, VariantMappingGroup>,
    matchedVariantsBefore: ReadonlyMap<string, ItemVariantRecord>,
  ): Promise<void> {
    const missingRows = [...variantGroups.entries()]
      .filter(([groupKey]) => !matchedVariantsBefore.has(groupKey))
      .map(([, group]) => ({
        canonicalItemId: group.canonicalItemId,
        ...this.toItemVariantCreateInput(group),
      }));
    const chunks = chunkArray(missingRows, CATALOG_CREATE_CHUNK_SIZE);

    for (const chunk of chunks) {
      await this.prismaService.itemVariant.createMany({
        data: chunk,
        skipDuplicates: true,
      });
    }
  }

  private buildCanonicalItemData(
    existingCanonicalItem: CanonicalItemRecord,
    group: CanonicalMappingGroup,
  ): Prisma.CanonicalItemUpdateInput {
    return {
      category: group.lastMapping.category,
      displayName: group.lastMapping.canonicalDisplayName,
      baseName: group.lastMapping.canonicalDisplayName,
      weaponName: group.lastMapping.weapon ?? null,
      finishName: group.lastMapping.skinName ?? null,
      exteriorSupported: group.lastMapping.floatRelevant,
      statTrakSupported:
        existingCanonicalItem.statTrakSupported === true ||
        group.statTrakSupported,
      souvenirSupported:
        existingCanonicalItem.souvenirSupported === true ||
        group.souvenirSupported,
      metadata: this.serializeJson({
        ...this.readJsonObject(existingCanonicalItem.metadata),
        mapping: this.buildCanonicalMetadataMapping(group.lastMapping),
        sources: this.mergeStringList(
          this.readStringList(existingCanonicalItem.metadata, 'sources'),
          [...group.sources],
        ),
      }),
    };
  }

  private toCanonicalItemCreateInput(
    group: CanonicalMappingGroup,
  ): Omit<Prisma.CanonicalItemCreateManyInput, 'slug'> {
    return {
      category: group.lastMapping.category,
      displayName: group.lastMapping.canonicalDisplayName,
      baseName: group.lastMapping.canonicalDisplayName,
      weaponName: group.lastMapping.weapon ?? null,
      finishName: group.lastMapping.skinName ?? null,
      exteriorSupported: group.lastMapping.floatRelevant,
      statTrakSupported: group.statTrakSupported,
      souvenirSupported: group.souvenirSupported,
      metadata: this.serializeJson({
        mapping: this.buildCanonicalMetadataMapping(group.lastMapping),
        sources: [...group.sources],
      }),
    };
  }

  private buildItemVariantData(
    existingVariant: ItemVariantRecord,
    group: VariantMappingGroup,
  ): Prisma.ItemVariantUpdateInput {
    return {
      variantKey: group.lastMapping.variantKey,
      displayName: group.lastMapping.variantDisplayName,
      phase: group.lastMapping.phase ?? null,
      isDefault: group.lastMapping.variantKey === 'default',
      isDoppler: group.lastMapping.isDoppler,
      isGammaDoppler: group.lastMapping.isGammaDoppler,
      patternRelevant: group.lastMapping.patternRelevant,
      floatRelevant: group.lastMapping.floatRelevant,
      metadata: this.serializeJson({
        ...this.readJsonObject(existingVariant.metadata),
        marketHashName: group.lastMapping.marketHashName,
        marketHashNames: this.mergeStringList(
          this.readStringList(existingVariant.metadata, 'marketHashNames'),
          [...group.marketHashNames],
        ),
        mapping: this.buildVariantMetadataMapping(group.lastMapping),
        sources: this.mergeStringList(
          this.readStringList(existingVariant.metadata, 'sources'),
          [...group.sources],
        ),
      }),
    };
  }

  private toItemVariantCreateInput(
    group: VariantMappingGroup,
  ): Omit<Prisma.ItemVariantCreateManyInput, 'canonicalItemId'> {
    return {
      variantKey: group.lastMapping.variantKey,
      displayName: group.lastMapping.variantDisplayName,
      phase: group.lastMapping.phase ?? null,
      isDefault: group.lastMapping.variantKey === 'default',
      isDoppler: group.lastMapping.isDoppler,
      isGammaDoppler: group.lastMapping.isGammaDoppler,
      patternRelevant: group.lastMapping.patternRelevant,
      floatRelevant: group.lastMapping.floatRelevant,
      metadata: this.serializeJson({
        marketHashName: group.lastMapping.marketHashName,
        marketHashNames: [...group.marketHashNames],
        mapping: this.buildVariantMetadataMapping(group.lastMapping),
        sources: [...group.sources],
      }),
    };
  }

  private buildCanonicalMetadataMapping(
    mapping: CatalogItemMappingDto,
  ): Prisma.InputJsonObject {
    return {
      type: mapping.type,
      ...(mapping.weapon ? { weapon: mapping.weapon } : {}),
      ...(mapping.skinName ? { skinName: mapping.skinName } : {}),
      ...(mapping.rarity ? { rarity: mapping.rarity } : {}),
      ...(mapping.defIndex !== undefined ? { defIndex: mapping.defIndex } : {}),
      ...(mapping.paintIndex !== undefined
        ? { paintIndex: mapping.paintIndex }
        : {}),
    };
  }

  private buildVariantMetadataMapping(
    mapping: CatalogItemMappingDto,
  ): Prisma.InputJsonObject {
    return {
      marketHashName: mapping.marketHashName,
      ...(mapping.exterior ? { exterior: mapping.exterior } : {}),
      stattrak: mapping.stattrak,
      souvenir: mapping.souvenir,
      ...(mapping.rarity ? { rarity: mapping.rarity } : {}),
      ...(mapping.phaseLabel ? { phaseLabel: mapping.phaseLabel } : {}),
      phaseFamily: mapping.phaseFamily,
      phaseConfidence: mapping.phaseConfidence,
      isVanilla: mapping.isVanilla,
      isGammaPhase: mapping.isGammaPhase,
      isDoppler: mapping.isDoppler,
      isGammaDoppler: mapping.isGammaDoppler,
      isReferencePatternRelevant: mapping.patternRelevant,
      isReferenceFloatRelevant: mapping.floatRelevant,
      patternSensitivity: mapping.patternSensitivity,
      floatSensitivity: mapping.floatSensitivity,
      confidence: mapping.confidence,
      ...(mapping.defIndex !== undefined ? { defIndex: mapping.defIndex } : {}),
      ...(mapping.paintIndex !== undefined
        ? { paintIndex: mapping.paintIndex }
        : {}),
    };
  }

  private resolveExistingVariant(
    itemVariants: ReadonlyMap<string, ItemVariantRecord>,
    canonicalItemId: string,
    mapping: CatalogItemMappingDto,
  ): ItemVariantRecord | undefined {
    const exactVariant = itemVariants.get(
      this.buildVariantIdentityKey(canonicalItemId, mapping.variantKey),
    );

    if (exactVariant) {
      return exactVariant;
    }

    const legacyVariantKey = this.buildLegacyVariantKey(
      mapping.phaseLabel,
      mapping.variantKey,
    );

    return legacyVariantKey
      ? itemVariants.get(
          this.buildVariantIdentityKey(canonicalItemId, legacyVariantKey),
        )
      : undefined;
  }

  private buildLegacyVariantKey(
    phaseLabel: string | undefined,
    variantKey: string,
  ): string | null {
    if (!phaseLabel) {
      return null;
    }

    const normalizedPhaseKey = slugify(phaseLabel);
    const legacyVariantKey = `${normalizedPhaseKey}:${normalizedPhaseKey}`;

    return legacyVariantKey === variantKey ? null : legacyVariantKey;
  }

  private buildVariantIdentityKey(
    canonicalItemId: string,
    variantKey: string,
  ): string {
    return `${canonicalItemId}:${variantKey}`;
  }

  private hasCanonicalItemChanges(
    existingCanonicalItem: CanonicalItemRecord,
    nextData: Prisma.CanonicalItemUpdateInput,
  ): boolean {
    return (
      existingCanonicalItem.category !== nextData.category ||
      existingCanonicalItem.displayName !== nextData.displayName ||
      existingCanonicalItem.baseName !== nextData.baseName ||
      existingCanonicalItem.weaponName !== nextData.weaponName ||
      existingCanonicalItem.finishName !== nextData.finishName ||
      existingCanonicalItem.exteriorSupported !== nextData.exteriorSupported ||
      existingCanonicalItem.statTrakSupported !== nextData.statTrakSupported ||
      existingCanonicalItem.souvenirSupported !== nextData.souvenirSupported ||
      !this.jsonEquals(existingCanonicalItem.metadata, nextData.metadata)
    );
  }

  private hasItemVariantChanges(
    existingVariant: ItemVariantRecord,
    nextData: Prisma.ItemVariantUpdateInput,
  ): boolean {
    return (
      existingVariant.variantKey !== nextData.variantKey ||
      existingVariant.displayName !== nextData.displayName ||
      existingVariant.phase !== nextData.phase ||
      existingVariant.isDefault !== nextData.isDefault ||
      existingVariant.isDoppler !== nextData.isDoppler ||
      existingVariant.isGammaDoppler !== nextData.isGammaDoppler ||
      existingVariant.patternRelevant !== nextData.patternRelevant ||
      existingVariant.floatRelevant !== nextData.floatRelevant ||
      !this.jsonEquals(existingVariant.metadata, nextData.metadata)
    );
  }

  private jsonEquals(left: unknown, right: unknown): boolean {
    return (
      JSON.stringify(this.normalizeJsonForComparison(left)) ===
      JSON.stringify(this.normalizeJsonForComparison(right))
    );
  }

  private normalizeJsonForComparison(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((entry) => this.normalizeJsonForComparison(entry));
    }

    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
          .map(([key, entryValue]) => [
            key,
            this.normalizeJsonForComparison(entryValue),
          ]),
      );
    }

    return value ?? null;
  }

  private readJsonObject(
    value: Prisma.JsonValue | null | undefined,
  ): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }

  private readStringList(
    value: Prisma.JsonValue | null | undefined,
    key: string,
  ): readonly string[] {
    const objectValue = this.readJsonObject(value);
    const listValue = objectValue[key];

    return Array.isArray(listValue)
      ? listValue.filter((entry): entry is string => typeof entry === 'string')
      : [];
  }

  private mergeStringList(
    currentValues: readonly string[],
    nextValues: readonly string[],
  ): readonly string[] {
    return [...new Set([...currentValues, ...nextValues])];
  }

  private serializeJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
