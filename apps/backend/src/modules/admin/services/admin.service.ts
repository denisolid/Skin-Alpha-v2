import {
  ArchiveEntityType,
  HealthStatus,
  ItemCategory,
  Prisma,
  SyncStatus,
  SyncType,
  UserRole,
  VariantPhase,
} from '@prisma/client';
import { Inject, ForbiddenException, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { AuthUserRecord } from '../../auth/domain/auth.repository';
import type { CatalogBootstrapResultDto } from '../../catalog/dto/catalog-bootstrap-result.dto';
import { CatalogBootstrapService } from '../../catalog/services/catalog-bootstrap.service';
import { MarketStateMergeService } from '../../market-state/services/market-state-merge.service';
import { MarketStateRebuildService } from '../../market-state/services/market-state-rebuild.service';
import { MarketStateUpdaterService } from '../../market-state/services/market-state-updater.service';
import type { MarketStateRebuildResultDto } from '../../market-state/dto/market-state-rebuild-result.dto';
import type { ScannerUniverseListDto } from '../../opportunities/dto/scanner-universe.dto';
import { OpportunityRescanService } from '../../opportunities/services/opportunity-rescan.service';
import { ScannerUniverseService } from '../../opportunities/services/scanner-universe.service';
import type { OpportunityRescanResultDto } from '../../opportunities/dto/opportunity-rescan-result.dto';
import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';
import type { NormalizedMarketStateDto } from '../../source-adapters/dto/normalized-market-state.dto';
import type {
  SourceSyncAcceptedDto,
  SourceSyncBatchAcceptedDto,
} from '../../source-adapters/dto/source-sync-accepted.dto';
import { RawPayloadArchiveService } from '../../source-adapters/services/raw-payload-archive.service';
import { SourceOperationsService } from '../../source-adapters/services/source-operations.service';
import { SourceSyncDispatchService } from '../../source-adapters/services/source-sync-dispatch.service';
import type { AdminBootstrapDevResponseDto } from '../dto/admin-bootstrap-dev-response.dto';

interface DemoCatalogSeedDefinition {
  readonly slug: string;
  readonly category: ItemCategory;
  readonly displayName: string;
  readonly baseName?: string;
  readonly weaponName?: string;
  readonly finishName?: string;
  readonly collectionName?: string;
  readonly exteriorSupported: boolean;
  readonly statTrakSupported: boolean;
  readonly souvenirSupported: boolean;
  readonly variantKey: string;
  readonly variantDisplayName: string;
  readonly phase?: VariantPhase;
  readonly isDefault: boolean;
  readonly isDoppler?: boolean;
  readonly isGammaDoppler?: boolean;
  readonly patternRelevant?: boolean;
  readonly floatRelevant?: boolean;
  readonly floatMin?: number;
  readonly floatMax?: number;
  readonly mapping: Prisma.InputJsonValue;
}

interface DemoCatalogSeedRecord {
  readonly canonicalItemId: string;
  readonly itemVariantId: string;
}

const DEMO_BOOTSTRAP_NAMESPACE = 'admin-bootstrap-dev';

const DEMO_CATALOG_SEEDS: readonly DemoCatalogSeedDefinition[] = [
  {
    slug: 'demo-ak-47-redline',
    category: ItemCategory.SKIN,
    displayName: 'AK-47 | Redline',
    weaponName: 'AK-47',
    finishName: 'Redline',
    collectionName: 'Phoenix Collection',
    exteriorSupported: true,
    statTrakSupported: true,
    souvenirSupported: false,
    variantKey: 'field-tested',
    variantDisplayName: 'AK-47 | Redline (Field-Tested)',
    isDefault: true,
    floatRelevant: true,
    floatMin: 0.15,
    floatMax: 0.38,
    mapping: {
      marketHashName: 'AK-47 | Redline (Field-Tested)',
      type: 'AK-47',
      weapon: 'AK-47',
      skinName: 'Redline',
      exterior: 'Field-Tested',
      rarity: 'Classified',
      stattrak: false,
      souvenir: false,
      defIndex: 7,
      paintIndex: 282,
    },
  },
  {
    slug: 'demo-butterfly-knife-doppler',
    category: ItemCategory.KNIFE,
    displayName: 'Butterfly Knife | Doppler',
    weaponName: 'Butterfly Knife',
    finishName: 'Doppler',
    exteriorSupported: false,
    statTrakSupported: true,
    souvenirSupported: false,
    variantKey: 'phase-2',
    variantDisplayName: 'Butterfly Knife | Doppler (Phase 2)',
    phase: VariantPhase.PHASE_2,
    isDefault: true,
    isDoppler: true,
    mapping: {
      marketHashName: 'Butterfly Knife | Doppler (Phase 2)',
      type: 'Butterfly Knife',
      weapon: 'Butterfly Knife',
      skinName: 'Doppler',
      exterior: null,
      rarity: 'Covert',
      stattrak: false,
      souvenir: false,
      defIndex: 515,
      paintIndex: 420,
    },
  },
  {
    slug: 'demo-sport-gloves-vice',
    category: ItemCategory.GLOVE,
    displayName: 'Sport Gloves | Vice',
    weaponName: 'Sport Gloves',
    finishName: 'Vice',
    exteriorSupported: true,
    statTrakSupported: false,
    souvenirSupported: false,
    variantKey: 'field-tested',
    variantDisplayName: 'Sport Gloves | Vice (Field-Tested)',
    isDefault: true,
    floatRelevant: true,
    floatMin: 0.15,
    floatMax: 0.38,
    mapping: {
      marketHashName: 'Sport Gloves | Vice (Field-Tested)',
      type: 'Sport Gloves',
      weapon: 'Sport Gloves',
      skinName: 'Vice',
      exterior: 'Field-Tested',
      rarity: 'Extraordinary',
      stattrak: false,
      souvenir: false,
      defIndex: 5030,
      paintIndex: 10048,
    },
  },
  {
    slug: 'demo-revolution-case',
    category: ItemCategory.CASE,
    displayName: 'Revolution Case',
    baseName: 'Revolution Case',
    exteriorSupported: false,
    statTrakSupported: false,
    souvenirSupported: false,
    variantKey: 'default',
    variantDisplayName: 'Revolution Case',
    isDefault: true,
    mapping: {
      marketHashName: 'Revolution Case',
      type: 'Case',
      weapon: null,
      skinName: 'Revolution Case',
      exterior: null,
      rarity: 'Base Grade',
      stattrak: false,
      souvenir: false,
      defIndex: 4001,
      paintIndex: 0,
    },
  },
  {
    slug: 'demo-copenhagen-2024-legends-capsule',
    category: ItemCategory.CAPSULE,
    displayName: 'Copenhagen 2024 Legends Capsule',
    baseName: 'Copenhagen 2024 Legends Capsule',
    exteriorSupported: false,
    statTrakSupported: false,
    souvenirSupported: false,
    variantKey: 'default',
    variantDisplayName: 'Copenhagen 2024 Legends Capsule',
    isDefault: true,
    mapping: {
      marketHashName: 'Copenhagen 2024 Legends Capsule',
      type: 'Capsule',
      weapon: null,
      skinName: 'Copenhagen 2024 Legends Capsule',
      exterior: null,
      rarity: 'Base Grade',
      stattrak: false,
      souvenir: false,
      defIndex: 5001,
      paintIndex: 0,
    },
  },
] as const;

@Injectable()
export class AdminService {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(CatalogBootstrapService)
    private readonly catalogBootstrapService: CatalogBootstrapService,
    @Inject(RawPayloadArchiveService)
    private readonly rawPayloadArchiveService: RawPayloadArchiveService,
    @Inject(MarketStateUpdaterService)
    private readonly marketStateUpdaterService: MarketStateUpdaterService,
    @Inject(SourceOperationsService)
    private readonly sourceOperationsService: SourceOperationsService,
    @Inject(SourceSyncDispatchService)
    private readonly sourceSyncDispatchService: SourceSyncDispatchService,
    @Inject(MarketStateMergeService)
    private readonly marketStateMergeService: MarketStateMergeService,
    @Inject(MarketStateRebuildService)
    private readonly marketStateRebuildService: MarketStateRebuildService,
    @Inject(OpportunityRescanService)
    private readonly opportunityRescanService: OpportunityRescanService,
    @Inject(ScannerUniverseService)
    private readonly scannerUniverseService: ScannerUniverseService,
  ) {}

  async bootstrapDev(
    user: Pick<AuthUserRecord, 'role'>,
  ): Promise<AdminBootstrapDevResponseDto> {
    this.assertAdminUser(user);

    const catalogSeed = await this.seedDemoCatalog();
    const now = new Date();
    const sourceStateBatches = this.createDemoMarketStateBatches(
      catalogSeed.items,
      now,
    );
    let marketSnapshotsCreated = 0;
    let marketStatesUpserted = 0;

    for (const [source, marketStates] of Object.entries(
      sourceStateBatches,
    ) as readonly [SourceAdapterKey, readonly NormalizedMarketStateDto[]][]) {
      const archivedPayload = await this.rawPayloadArchiveService.archive({
        source,
        endpointName: 'admin/bootstrap/dev-market-state',
        observedAt: now,
        externalId: `${DEMO_BOOTSTRAP_NAMESPACE}:${source}:${now.toISOString()}`,
        entityType: ArchiveEntityType.MARKET_SNAPSHOT,
        payload: {
          demo: true,
          namespace: DEMO_BOOTSTRAP_NAMESPACE,
          source,
          marketStates: marketStates.map((marketState) => ({
            canonicalItemId: marketState.canonicalItemId,
            itemVariantId: marketState.itemVariantId,
            currency: marketState.currency,
            lowestAskMinor: marketState.lowestAskMinor,
            highestBidMinor: marketState.highestBidMinor,
            average24hMinor: marketState.average24hMinor,
            lastTradeMinor: marketState.lastTradeMinor,
            listingCount: marketState.listingCount,
            confidence: marketState.confidence,
            capturedAt: marketState.capturedAt.toISOString(),
          })),
        },
        contentType: 'application/json',
        httpStatus: 200,
      });
      const updateResult =
        await this.marketStateUpdaterService.updateLatestStateBatch({
          source,
          marketStates,
          rawPayloadArchiveId: archivedPayload.id,
        });

      marketSnapshotsCreated += updateResult.snapshotCount;
      marketStatesUpserted += updateResult.upsertedStateCount;

      await this.sourceOperationsService.upsertSyncStatus({
        source,
        syncType: SyncType.MARKET_STATE,
        status: SyncStatus.SUCCEEDED,
        details: {
          demo: true,
          namespace: DEMO_BOOTSTRAP_NAMESPACE,
          marketStateCount: marketStates.length,
        },
        markSuccessful: true,
      });
      await this.sourceOperationsService.recordHealthMetric({
        source,
        status: HealthStatus.OK,
        availabilityRatio: 1,
        errorRate: 0,
        latencyMs: 10,
        details: {
          demo: true,
          namespace: DEMO_BOOTSTRAP_NAMESPACE,
        },
      });
    }

    const steamFallbackSeedResult = await this.seedSteamFallbackHistory(
      catalogSeed.items[0]!,
      now,
    );
    marketSnapshotsCreated += steamFallbackSeedResult.snapshotCount;
    marketStatesUpserted += steamFallbackSeedResult.upsertedStateCount;

    await Promise.all(
      catalogSeed.items.map((item) =>
        this.marketStateMergeService.getVariantMatrix(item.itemVariantId),
      ),
    );

    const rescanResult = await this.opportunityRescanService.rescanAndPersist();

    return {
      canonicalItemsCreated: catalogSeed.canonicalItemsCreated,
      itemVariantsCreated: catalogSeed.itemVariantsCreated,
      marketSnapshotsCreated,
      marketStatesUpserted,
      opportunitiesCreated: rescanResult.persistedOpportunityCount,
    };
  }

  rebuildMarketState(
    user: Pick<AuthUserRecord, 'role'>,
  ): Promise<MarketStateRebuildResultDto> {
    this.assertAdminUser(user);

    return this.marketStateRebuildService.rebuildLatestStateProjection();
  }

  rescanOpportunities(
    user: Pick<AuthUserRecord, 'role'>,
  ): Promise<OpportunityRescanResultDto> {
    this.assertAdminUser(user);

    return this.opportunityRescanService.rescanAndPersist();
  }

  bootstrapCatalog(
    user: Pick<AuthUserRecord, 'role'>,
  ): Promise<CatalogBootstrapResultDto> {
    this.assertAdminUser(user);

    return this.catalogBootstrapService.bootstrapControlledUniverse();
  }

  syncSource(
    user: Pick<AuthUserRecord, 'role'>,
    source: SourceAdapterKey,
  ): Promise<SourceSyncAcceptedDto> {
    this.assertAdminUser(user);

    return this.sourceSyncDispatchService.dispatchManualSync(source);
  }

  syncAllSources(
    user: Pick<AuthUserRecord, 'role'>,
  ): Promise<SourceSyncBatchAcceptedDto> {
    this.assertAdminUser(user);

    return this.sourceSyncDispatchService.dispatchManualSyncAll();
  }

  rebuildScannerUniverse(
    user: Pick<AuthUserRecord, 'role'>,
  ): Promise<ScannerUniverseListDto> {
    this.assertAdminUser(user);

    return this.scannerUniverseService.getScannerUniverse({
      limit: 100,
    });
  }

  private async seedDemoCatalog(): Promise<{
    readonly canonicalItemsCreated: number;
    readonly itemVariantsCreated: number;
    readonly items: readonly DemoCatalogSeedRecord[];
  }> {
    let canonicalItemsCreated = 0;
    let itemVariantsCreated = 0;
    const items: DemoCatalogSeedRecord[] = [];

    for (const seed of DEMO_CATALOG_SEEDS) {
      const existingCanonicalItem =
        await this.prismaService.canonicalItem.findUnique({
          where: {
            slug: seed.slug,
          },
          select: {
            id: true,
          },
        });
      const canonicalItem = await this.prismaService.canonicalItem.upsert({
        where: {
          slug: seed.slug,
        },
        create: {
          slug: seed.slug,
          category: seed.category,
          displayName: seed.displayName,
          ...(seed.baseName ? { baseName: seed.baseName } : {}),
          ...(seed.weaponName ? { weaponName: seed.weaponName } : {}),
          ...(seed.finishName ? { finishName: seed.finishName } : {}),
          ...(seed.collectionName
            ? { collectionName: seed.collectionName }
            : {}),
          exteriorSupported: seed.exteriorSupported,
          statTrakSupported: seed.statTrakSupported,
          souvenirSupported: seed.souvenirSupported,
          metadata: {
            demo: true,
            namespace: DEMO_BOOTSTRAP_NAMESPACE,
            mapping: seed.mapping,
          },
        },
        update: {
          category: seed.category,
          displayName: seed.displayName,
          baseName: seed.baseName ?? null,
          weaponName: seed.weaponName ?? null,
          finishName: seed.finishName ?? null,
          collectionName: seed.collectionName ?? null,
          exteriorSupported: seed.exteriorSupported,
          statTrakSupported: seed.statTrakSupported,
          souvenirSupported: seed.souvenirSupported,
          metadata: {
            demo: true,
            namespace: DEMO_BOOTSTRAP_NAMESPACE,
            mapping: seed.mapping,
          },
        },
      });

      if (!existingCanonicalItem) {
        canonicalItemsCreated += 1;
      }

      const existingItemVariant =
        await this.prismaService.itemVariant.findUnique({
          where: {
            canonicalItemId_variantKey: {
              canonicalItemId: canonicalItem.id,
              variantKey: seed.variantKey,
            },
          },
          select: {
            id: true,
          },
        });
      const itemVariant = await this.prismaService.itemVariant.upsert({
        where: {
          canonicalItemId_variantKey: {
            canonicalItemId: canonicalItem.id,
            variantKey: seed.variantKey,
          },
        },
        create: {
          canonicalItemId: canonicalItem.id,
          variantKey: seed.variantKey,
          displayName: seed.variantDisplayName,
          ...(seed.phase ? { phase: seed.phase } : {}),
          isDefault: seed.isDefault,
          isDoppler: seed.isDoppler ?? false,
          isGammaDoppler: seed.isGammaDoppler ?? false,
          patternRelevant: seed.patternRelevant ?? false,
          floatRelevant: seed.floatRelevant ?? false,
          ...(seed.floatMin !== undefined ? { floatMin: seed.floatMin } : {}),
          ...(seed.floatMax !== undefined ? { floatMax: seed.floatMax } : {}),
          metadata: {
            demo: true,
            namespace: DEMO_BOOTSTRAP_NAMESPACE,
            mapping: seed.mapping,
          },
        },
        update: {
          displayName: seed.variantDisplayName,
          phase: seed.phase ?? null,
          isDefault: seed.isDefault,
          isDoppler: seed.isDoppler ?? false,
          isGammaDoppler: seed.isGammaDoppler ?? false,
          patternRelevant: seed.patternRelevant ?? false,
          floatRelevant: seed.floatRelevant ?? false,
          floatMin: seed.floatMin ?? null,
          floatMax: seed.floatMax ?? null,
          metadata: {
            demo: true,
            namespace: DEMO_BOOTSTRAP_NAMESPACE,
            mapping: seed.mapping,
          },
        },
      });

      if (!existingItemVariant) {
        itemVariantsCreated += 1;
      }

      items.push({
        canonicalItemId: canonicalItem.id,
        itemVariantId: itemVariant.id,
      });
    }

    return {
      canonicalItemsCreated,
      itemVariantsCreated,
      items,
    };
  }

  private createDemoMarketStateBatches(
    items: readonly DemoCatalogSeedRecord[],
    now: Date,
  ): Readonly<Record<SourceAdapterKey, readonly NormalizedMarketStateDto[]>> {
    const timestamps = {
      skinport: now,
      csfloat: new Date(now.getTime() - 2 * 60 * 1000),
      'steam-snapshot': new Date(now.getTime() - 20 * 60 * 1000),
      'backup-aggregator': new Date(now.getTime() - 5 * 60 * 1000),
    } as const;

    return {
      skinport: [
        this.createMarketState(items[0]!, timestamps.skinport, {
          source: 'skinport',
          lowestAskMinor: 7800,
          average24hMinor: 8050,
          lastTradeMinor: 7925,
          listingCount: 18,
          saleCount24h: 11,
          confidence: 0.9,
          liquidityScore: 0.78,
        }),
        this.createMarketState(items[1]!, timestamps.skinport, {
          source: 'skinport',
          lowestAskMinor: 68000,
          average24hMinor: 69400,
          lastTradeMinor: 68850,
          listingCount: 6,
          saleCount24h: 3,
          confidence: 0.82,
          liquidityScore: 0.51,
        }),
        this.createMarketState(items[2]!, timestamps.skinport, {
          source: 'skinport',
          lowestAskMinor: 52000,
          average24hMinor: 53450,
          lastTradeMinor: 52800,
          listingCount: 5,
          saleCount24h: 2,
          confidence: 0.8,
          liquidityScore: 0.47,
        }),
        this.createMarketState(items[3]!, timestamps.skinport, {
          source: 'skinport',
          lowestAskMinor: 210,
          average24hMinor: 224,
          lastTradeMinor: 218,
          listingCount: 150,
          saleCount24h: 70,
          confidence: 0.96,
          liquidityScore: 0.94,
        }),
        this.createMarketState(items[4]!, timestamps.skinport, {
          source: 'skinport',
          lowestAskMinor: 190,
          average24hMinor: 205,
          lastTradeMinor: 198,
          listingCount: 120,
          saleCount24h: 61,
          confidence: 0.95,
          liquidityScore: 0.9,
        }),
      ],
      csfloat: [
        this.createMarketState(items[0]!, timestamps.csfloat, {
          source: 'csfloat',
          lowestAskMinor: 8400,
          highestBidMinor: 8400,
          average24hMinor: 8320,
          lastTradeMinor: 8350,
          listingCount: 14,
          saleCount24h: 9,
          confidence: 0.93,
          liquidityScore: 0.81,
        }),
        this.createMarketState(items[1]!, timestamps.csfloat, {
          source: 'csfloat',
          lowestAskMinor: 74800,
          highestBidMinor: 74200,
          average24hMinor: 73500,
          lastTradeMinor: 73900,
          listingCount: 7,
          saleCount24h: 3,
          confidence: 0.87,
          liquidityScore: 0.56,
        }),
        this.createMarketState(items[2]!, timestamps.csfloat, {
          source: 'csfloat',
          lowestAskMinor: 56100,
          highestBidMinor: 55500,
          average24hMinor: 54800,
          lastTradeMinor: 55100,
          listingCount: 4,
          saleCount24h: 2,
          confidence: 0.84,
          liquidityScore: 0.43,
        }),
        this.createMarketState(items[3]!, timestamps.csfloat, {
          source: 'csfloat',
          lowestAskMinor: 345,
          highestBidMinor: 340,
          average24hMinor: 330,
          lastTradeMinor: 334,
          listingCount: 160,
          saleCount24h: 82,
          confidence: 0.97,
          liquidityScore: 0.97,
        }),
        this.createMarketState(items[4]!, timestamps.csfloat, {
          source: 'csfloat',
          lowestAskMinor: 332,
          highestBidMinor: 325,
          average24hMinor: 318,
          lastTradeMinor: 321,
          listingCount: 135,
          saleCount24h: 72,
          confidence: 0.96,
          liquidityScore: 0.93,
        }),
      ],
      'steam-snapshot': [
        this.createMarketState(items[0]!, timestamps['steam-snapshot'], {
          source: 'steam-snapshot',
          lowestAskMinor: 8150,
          highestBidMinor: 7900,
          average24hMinor: 8080,
          lastTradeMinor: 8040,
          listingCount: 45,
          saleCount24h: 25,
          confidence: 0.74,
          liquidityScore: 0.88,
        }),
        this.createMarketState(items[1]!, timestamps['steam-snapshot'], {
          source: 'steam-snapshot',
          lowestAskMinor: 70500,
          highestBidMinor: 69000,
          average24hMinor: 69700,
          lastTradeMinor: 69400,
          listingCount: 18,
          saleCount24h: 5,
          confidence: 0.69,
          liquidityScore: 0.48,
        }),
        this.createMarketState(items[2]!, timestamps['steam-snapshot'], {
          source: 'steam-snapshot',
          lowestAskMinor: 53500,
          highestBidMinor: 51900,
          average24hMinor: 53000,
          lastTradeMinor: 52600,
          listingCount: 12,
          saleCount24h: 4,
          confidence: 0.66,
          liquidityScore: 0.42,
        }),
        this.createMarketState(items[3]!, timestamps['steam-snapshot'], {
          source: 'steam-snapshot',
          lowestAskMinor: 228,
          highestBidMinor: 215,
          average24hMinor: 223,
          lastTradeMinor: 220,
          listingCount: 240,
          saleCount24h: 110,
          confidence: 0.76,
          liquidityScore: 0.98,
        }),
        this.createMarketState(items[4]!, timestamps['steam-snapshot'], {
          source: 'steam-snapshot',
          lowestAskMinor: 205,
          highestBidMinor: 194,
          average24hMinor: 202,
          lastTradeMinor: 199,
          listingCount: 210,
          saleCount24h: 108,
          confidence: 0.74,
          liquidityScore: 0.95,
        }),
      ],
      'backup-aggregator': [
        this.createMarketState(items[0]!, timestamps['backup-aggregator'], {
          source: 'backup-aggregator',
          lowestAskMinor: 8125,
          average24hMinor: 8090,
          lastTradeMinor: 8070,
          listingCount: 22,
          saleCount24h: 0,
          confidence: 0.63,
          liquidityScore: 0.61,
        }),
        this.createMarketState(items[1]!, timestamps['backup-aggregator'], {
          source: 'backup-aggregator',
          lowestAskMinor: 71000,
          average24hMinor: 70600,
          lastTradeMinor: 70400,
          listingCount: 10,
          saleCount24h: 0,
          confidence: 0.58,
          liquidityScore: 0.39,
        }),
        this.createMarketState(items[2]!, timestamps['backup-aggregator'], {
          source: 'backup-aggregator',
          lowestAskMinor: 54000,
          average24hMinor: 53600,
          lastTradeMinor: 53450,
          listingCount: 8,
          saleCount24h: 0,
          confidence: 0.57,
          liquidityScore: 0.36,
        }),
        this.createMarketState(items[3]!, timestamps['backup-aggregator'], {
          source: 'backup-aggregator',
          lowestAskMinor: 320,
          average24hMinor: 318,
          lastTradeMinor: 316,
          listingCount: 90,
          saleCount24h: 0,
          confidence: 0.66,
          liquidityScore: 0.76,
        }),
        this.createMarketState(items[4]!, timestamps['backup-aggregator'], {
          source: 'backup-aggregator',
          lowestAskMinor: 315,
          average24hMinor: 309,
          lastTradeMinor: 307,
          listingCount: 88,
          saleCount24h: 0,
          confidence: 0.64,
          liquidityScore: 0.72,
        }),
      ],
      youpin: [],
      bitskins: [],
      c5game: [],
      csmoney: [],
    };
  }

  private async seedSteamFallbackHistory(
    item: DemoCatalogSeedRecord,
    now: Date,
  ): Promise<{
    readonly snapshotCount: number;
    readonly upsertedStateCount: number;
  }> {
    const earlierSnapshot = await this.rawPayloadArchiveService.archive({
      source: 'steam-snapshot',
      endpointName: 'admin/bootstrap/dev-market-state-fallback-history',
      observedAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
      externalId: `${DEMO_BOOTSTRAP_NAMESPACE}:steam-snapshot:fallback-history`,
      entityType: ArchiveEntityType.MARKET_SNAPSHOT,
      payload: {
        demo: true,
        namespace: DEMO_BOOTSTRAP_NAMESPACE,
        mode: 'historical-fallback-source',
      },
      contentType: 'application/json',
      httpStatus: 200,
    });

    const initialUpdateResult =
      await this.marketStateUpdaterService.updateLatestStateBatch({
        source: 'steam-snapshot',
        rawPayloadArchiveId: earlierSnapshot.id,
        marketStates: [
          this.createMarketState(
            item,
            new Date(now.getTime() - 3 * 60 * 60 * 1000),
            {
              source: 'steam-snapshot',
              lowestAskMinor: 8025,
              highestBidMinor: 7880,
              average24hMinor: 7980,
              lastTradeMinor: 7960,
              listingCount: 39,
              saleCount24h: 22,
              confidence: 0.73,
              liquidityScore: 0.82,
            },
          ),
        ],
      });

    const currentSnapshot = await this.rawPayloadArchiveService.archive({
      source: 'steam-snapshot',
      endpointName: 'admin/bootstrap/dev-market-state-fallback-current',
      observedAt: new Date(now.getTime() - 35 * 60 * 1000),
      externalId: `${DEMO_BOOTSTRAP_NAMESPACE}:steam-snapshot:fallback-current`,
      entityType: ArchiveEntityType.MARKET_SNAPSHOT,
      payload: {
        demo: true,
        namespace: DEMO_BOOTSTRAP_NAMESPACE,
        mode: 'missing-live-signal',
      },
      contentType: 'application/json',
      httpStatus: 200,
    });

    const currentUpdateResult =
      await this.marketStateUpdaterService.updateLatestStateBatch({
        source: 'steam-snapshot',
        rawPayloadArchiveId: currentSnapshot.id,
        marketStates: [
          this.createMarketState(
            item,
            new Date(now.getTime() - 35 * 60 * 1000),
            {
              source: 'steam-snapshot',
              average24hMinor: 8010,
              lastTradeMinor: 7990,
              saleCount24h: 22,
              sampleSize: 40,
              confidence: 0.58,
              liquidityScore: 0.7,
            },
          ),
        ],
      });

    return {
      snapshotCount:
        initialUpdateResult.snapshotCount + currentUpdateResult.snapshotCount,
      upsertedStateCount:
        initialUpdateResult.upsertedStateCount +
        currentUpdateResult.upsertedStateCount,
    };
  }

  private createMarketState(
    item: DemoCatalogSeedRecord,
    capturedAt: Date,
    input: {
      readonly source: SourceAdapterKey;
      readonly lowestAskMinor?: number;
      readonly highestBidMinor?: number;
      readonly average24hMinor?: number;
      readonly lastTradeMinor?: number;
      readonly listingCount?: number;
      readonly saleCount24h?: number;
      readonly sampleSize?: number;
      readonly confidence?: number;
      readonly liquidityScore?: number;
    },
  ): NormalizedMarketStateDto {
    return {
      source: input.source,
      canonicalItemId: item.canonicalItemId,
      itemVariantId: item.itemVariantId,
      capturedAt,
      currency: 'USD',
      ...(input.lowestAskMinor !== undefined
        ? { lowestAskMinor: input.lowestAskMinor }
        : {}),
      ...(input.highestBidMinor !== undefined
        ? { highestBidMinor: input.highestBidMinor }
        : {}),
      ...(input.average24hMinor !== undefined
        ? { average24hMinor: input.average24hMinor }
        : {}),
      ...(input.lastTradeMinor !== undefined
        ? { lastTradeMinor: input.lastTradeMinor }
        : {}),
      ...(input.listingCount !== undefined
        ? { listingCount: input.listingCount }
        : {}),
      ...(input.saleCount24h !== undefined
        ? { saleCount24h: input.saleCount24h }
        : {}),
      ...(input.sampleSize !== undefined
        ? { sampleSize: input.sampleSize }
        : {}),
      ...(input.confidence !== undefined
        ? { confidence: input.confidence }
        : {}),
      ...(input.liquidityScore !== undefined
        ? { liquidityScore: input.liquidityScore }
        : {}),
      metadata: {
        demo: true,
        namespace: DEMO_BOOTSTRAP_NAMESPACE,
      },
    };
  }

  private assertAdminUser(user: Pick<AuthUserRecord, 'role'>): void {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'Administrator role is required for admin tooling.',
      );
    }
  }
}
