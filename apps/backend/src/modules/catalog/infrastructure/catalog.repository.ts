import { Prisma } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { createModuleSkeletonStatus } from '../../shared/module-skeleton.types';
import type {
  CatalogRepository,
  PersistCatalogMappingInput,
  PersistedCatalogMapping,
} from '../domain/catalog.repository';

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
    return this.prismaService.$transaction(async (transaction) => {
      const existingCanonicalItem = await transaction.canonicalItem.findUnique({
        where: {
          slug: input.mapping.canonicalSlug,
        },
      });
      const canonicalItemMetadata = this.serializeJson({
        ...this.readJsonObject(existingCanonicalItem?.metadata),
        mapping: {
          type: input.mapping.type,
          ...(input.mapping.weapon ? { weapon: input.mapping.weapon } : {}),
          ...(input.mapping.skinName
            ? { skinName: input.mapping.skinName }
            : {}),
          ...(input.mapping.rarity ? { rarity: input.mapping.rarity } : {}),
          ...(input.mapping.defIndex !== undefined
            ? { defIndex: input.mapping.defIndex }
            : {}),
          ...(input.mapping.paintIndex !== undefined
            ? { paintIndex: input.mapping.paintIndex }
            : {}),
        },
        sources: this.mergeStringList(
          this.readStringList(existingCanonicalItem?.metadata, 'sources'),
          input.source,
        ),
      });
      const canonicalItem = existingCanonicalItem
        ? await transaction.canonicalItem.update({
            where: {
              id: existingCanonicalItem.id,
            },
            data: {
              category: input.mapping.category,
              displayName: input.mapping.canonicalDisplayName,
              baseName: input.mapping.canonicalDisplayName,
              weaponName: input.mapping.weapon ?? null,
              finishName: input.mapping.skinName ?? null,
              exteriorSupported: input.mapping.floatRelevant,
              statTrakSupported:
                existingCanonicalItem.statTrakSupported ||
                input.mapping.stattrak,
              souvenirSupported:
                existingCanonicalItem.souvenirSupported ||
                input.mapping.souvenir,
              metadata: canonicalItemMetadata,
            },
          })
        : await transaction.canonicalItem.create({
            data: {
              slug: input.mapping.canonicalSlug,
              category: input.mapping.category,
              displayName: input.mapping.canonicalDisplayName,
              baseName: input.mapping.canonicalDisplayName,
              weaponName: input.mapping.weapon ?? null,
              finishName: input.mapping.skinName ?? null,
              exteriorSupported: input.mapping.floatRelevant,
              statTrakSupported: input.mapping.stattrak,
              souvenirSupported: input.mapping.souvenir,
              metadata: canonicalItemMetadata,
            },
          });
      const existingVariant = await transaction.itemVariant.findUnique({
        where: {
          canonicalItemId_variantKey: {
            canonicalItemId: canonicalItem.id,
            variantKey: input.mapping.variantKey,
          },
        },
      });
      const variantMetadata = this.serializeJson({
        ...this.readJsonObject(existingVariant?.metadata),
        marketHashName: input.mapping.marketHashName,
        marketHashNames: this.mergeStringList(
          this.readStringList(existingVariant?.metadata, 'marketHashNames'),
          input.mapping.marketHashName,
        ),
        mapping: {
          marketHashName: input.mapping.marketHashName,
          ...(input.mapping.exterior
            ? { exterior: input.mapping.exterior }
            : {}),
          stattrak: input.mapping.stattrak,
          souvenir: input.mapping.souvenir,
          ...(input.mapping.rarity ? { rarity: input.mapping.rarity } : {}),
          ...(input.mapping.phaseLabel
            ? { phaseLabel: input.mapping.phaseLabel }
            : {}),
          isVanilla: input.mapping.isVanilla,
          isGammaPhase: input.mapping.isGammaPhase,
          isReferencePatternRelevant: input.mapping.patternRelevant,
          isReferenceFloatRelevant: input.mapping.floatRelevant,
          confidence: input.mapping.confidence,
          ...(input.mapping.defIndex !== undefined
            ? { defIndex: input.mapping.defIndex }
            : {}),
          ...(input.mapping.paintIndex !== undefined
            ? { paintIndex: input.mapping.paintIndex }
            : {}),
        },
        sources: this.mergeStringList(
          this.readStringList(existingVariant?.metadata, 'sources'),
          input.source,
        ),
      });
      const itemVariant = existingVariant
        ? await transaction.itemVariant.update({
            where: {
              id: existingVariant.id,
            },
            data: {
              displayName: input.mapping.variantDisplayName,
              phase: input.mapping.phase ?? null,
              isDefault: input.mapping.variantKey === 'default',
              isDoppler: input.mapping.isDoppler,
              isGammaDoppler: input.mapping.isGammaDoppler,
              patternRelevant: input.mapping.patternRelevant,
              floatRelevant: input.mapping.floatRelevant,
              metadata: variantMetadata,
            },
          })
        : await transaction.itemVariant.create({
            data: {
              canonicalItemId: canonicalItem.id,
              variantKey: input.mapping.variantKey,
              displayName: input.mapping.variantDisplayName,
              phase: input.mapping.phase ?? null,
              isDefault: input.mapping.variantKey === 'default',
              isDoppler: input.mapping.isDoppler,
              isGammaDoppler: input.mapping.isGammaDoppler,
              patternRelevant: input.mapping.patternRelevant,
              floatRelevant: input.mapping.floatRelevant,
              metadata: variantMetadata,
            },
          });

      return {
        canonicalItemId: canonicalItem.id,
        itemVariantId: itemVariant.id,
        category: canonicalItem.category,
      };
    });
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
    nextValue: string,
  ): readonly string[] {
    return [...new Set([...currentValues, nextValue])];
  }

  private serializeJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
