import { Prisma, SourceKind } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../infrastructure/config/app-config.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { SourceBehaviorFlagsModel } from '../domain/source-behavior-flags.model';
import type { SourceClassification } from '../domain/source-classification.model';
import type {
  SourceAdapterKey,
  SourceCategory,
  SourceSyncMode,
} from '../domain/source-adapter.types';

interface ResolvedSourceRecord {
  readonly id: string;
  readonly code: SourceAdapterKey;
}

interface SourceRecordDefinition {
  readonly name: string;
  readonly category: SourceCategory;
  readonly supportedSyncModes: readonly SourceSyncMode[];
  readonly classification: SourceClassification;
  readonly behavior: SourceBehaviorFlagsModel;
  readonly isEnabled: boolean;
  readonly baseUrl?: string;
  readonly metadata?: Prisma.InputJsonObject;
}

@Injectable()
export class SourceRecordService {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
  ) {}

  async resolveByKey(source: SourceAdapterKey): Promise<ResolvedSourceRecord> {
    const definition = this.getDefinition(source);
    const metadata = this.buildMetadata(definition);
    const persistedSource = await this.prismaService.source.upsert({
      where: {
        code: source,
      },
      create: {
        code: source,
        name: definition.name,
        kind: this.mapCategoryToSourceKind(definition.category),
        ...(definition.baseUrl ? { baseUrl: definition.baseUrl } : {}),
        isEnabled: definition.isEnabled,
        metadata,
      },
      update: {
        name: definition.name,
        kind: this.mapCategoryToSourceKind(definition.category),
        baseUrl: definition.baseUrl ?? null,
        isEnabled: definition.isEnabled,
        metadata,
      },
    });

    return {
      id: persistedSource.id,
      code: persistedSource.code as SourceAdapterKey,
    };
  }

  private buildMetadata(
    definition: SourceRecordDefinition,
  ): Prisma.InputJsonObject {
    return {
      supportedSyncModes: definition.supportedSyncModes,
      classification: definition.classification,
      behavior: {
        canDrivePrimaryTruth: definition.behavior.canDrivePrimaryTruth,
        canProvideFallbackPricing:
          definition.behavior.canProvideFallbackPricing,
        canProvideQuantitySignals:
          definition.behavior.canProvideQuantitySignals,
        canBeUsedForPairBuilding: definition.behavior.canBeUsedForPairBuilding,
        canBeUsedForConfirmationOnly:
          definition.behavior.canBeUsedForConfirmationOnly,
      },
      ...(definition.behavior.canDrivePrimaryTruth
        ? {}
        : { role: 'reference-only' }),
      ...(definition.metadata ?? {}),
    };
  }

  private getDefinition(source: SourceAdapterKey): SourceRecordDefinition {
    switch (source) {
      case 'skinport':
        return {
          name: 'Skinport',
          category: 'marketplace',
          supportedSyncModes: ['full-snapshot', 'market-state-only'],
          classification: 'PRIMARY',
          behavior: {
            canDrivePrimaryTruth: true,
            canProvideFallbackPricing: true,
            canProvideQuantitySignals: true,
            canBeUsedForPairBuilding: true,
            canBeUsedForConfirmationOnly: true,
          },
          isEnabled: true,
          baseUrl: this.configService.skinportApiBaseUrl,
        };
      case 'csfloat':
        return {
          name: 'CSFloat',
          category: 'marketplace',
          supportedSyncModes: [
            'full-snapshot',
            'incremental',
            'market-state-only',
          ],
          classification: 'PRIMARY',
          behavior: {
            canDrivePrimaryTruth: true,
            canProvideFallbackPricing: true,
            canProvideQuantitySignals: true,
            canBeUsedForPairBuilding: true,
            canBeUsedForConfirmationOnly: true,
          },
          isEnabled: true,
          baseUrl: this.configService.csfloatApiBaseUrl,
        };
      case 'bitskins':
        return {
          name: 'BitSkins',
          category: 'marketplace',
          supportedSyncModes: ['full-snapshot', 'market-state-only'],
          classification: 'PRIMARY',
          behavior: {
            canDrivePrimaryTruth: true,
            canProvideFallbackPricing: true,
            canProvideQuantitySignals: true,
            canBeUsedForPairBuilding: true,
            canBeUsedForConfirmationOnly: true,
          },
          isEnabled: this.configService.isBitSkinsEnabled(),
          baseUrl: this.configService.bitskinsApiBaseUrl,
        };
      case 'youpin':
        return {
          name: 'YouPin',
          category: 'marketplace',
          supportedSyncModes: ['full-snapshot', 'market-state-only'],
          classification: this.configService.youpinReferenceOnly
            ? 'REFERENCE'
            : 'PRIMARY',
          behavior: {
            canDrivePrimaryTruth:
              this.configService.isYouPinPrimaryTruthEnabled(),
            canProvideFallbackPricing: true,
            canProvideQuantitySignals: true,
            canBeUsedForPairBuilding:
              this.configService.isYouPinPrimaryTruthEnabled(),
            canBeUsedForConfirmationOnly:
              !this.configService.isYouPinPrimaryTruthEnabled(),
          },
          isEnabled: this.configService.isYouPinEnabled(),
          baseUrl: this.configService.youpinApiBaseUrl,
          metadata: {
            mode: this.configService.isYouPinPrimaryTruthEnabled()
              ? 'primary'
              : 'reference',
          },
        };
      case 'c5game':
        return {
          name: 'C5Game',
          category: 'marketplace',
          supportedSyncModes: ['full-snapshot', 'market-state-only'],
          classification: 'OPTIONAL',
          behavior: {
            canDrivePrimaryTruth: true,
            canProvideFallbackPricing: true,
            canProvideQuantitySignals: true,
            canBeUsedForPairBuilding: true,
            canBeUsedForConfirmationOnly: true,
          },
          isEnabled: this.configService.isC5GameEnabled(),
          baseUrl: this.configService.c5gameApiBaseUrl,
          metadata: {
            featureFlag: 'ENABLE_C5GAME',
          },
        };
      case 'csmoney':
        return {
          name: 'CS.MONEY',
          category: 'marketplace',
          supportedSyncModes: ['full-snapshot', 'market-state-only'],
          classification: 'FRAGILE',
          behavior: {
            canDrivePrimaryTruth: true,
            canProvideFallbackPricing: true,
            canProvideQuantitySignals: true,
            canBeUsedForPairBuilding: true,
            canBeUsedForConfirmationOnly: true,
          },
          isEnabled: this.configService.isCSMoneyEnabled(),
          baseUrl: this.configService.csmoneyApiBaseUrl,
          metadata: {
            featureFlag: 'ENABLE_CSMONEY',
            reliability: 'fragile',
          },
        };
      case 'steam-snapshot':
        return {
          name: 'Steam Snapshot',
          category: 'snapshot',
          supportedSyncModes: ['full-snapshot', 'market-state-only'],
          classification: 'OPTIONAL',
          behavior: {
            canDrivePrimaryTruth: true,
            canProvideFallbackPricing: true,
            canProvideQuantitySignals: true,
            canBeUsedForPairBuilding: true,
            canBeUsedForConfirmationOnly: true,
          },
          isEnabled: this.configService.isSteamSnapshotEnabled(),
          baseUrl: this.configService.steamSnapshotApiBaseUrl,
        };
      case 'backup-aggregator':
        return {
          name: 'Backup Aggregator',
          category: 'aggregator',
          supportedSyncModes: ['full-snapshot', 'market-state-only'],
          classification: 'REFERENCE',
          behavior: {
            canDrivePrimaryTruth: false,
            canProvideFallbackPricing: true,
            canProvideQuantitySignals: true,
            canBeUsedForPairBuilding: false,
            canBeUsedForConfirmationOnly: true,
          },
          isEnabled: this.configService.isBackupAggregatorEnabled(),
          metadata: {
            note: 'Reference pricing for resilience and sanity checks, not primary source truth.',
          },
        };
    }
  }

  private mapCategoryToSourceKind(category: SourceCategory): SourceKind {
    switch (category) {
      case 'marketplace':
        return SourceKind.MARKETPLACE;
      case 'aggregator':
        return SourceKind.AGGREGATOR;
      case 'snapshot':
        return SourceKind.OFFICIAL;
    }
  }
}
