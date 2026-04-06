import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Module, type Provider } from '@nestjs/common';
import type { Queue } from 'bullmq';

import { CatalogModule } from '../catalog/catalog.module';
import { SourceAdaptersController } from './controllers/source-adapters.controller';
import {
  SOURCE_ADAPTERS,
  SOURCE_SCHEDULER,
} from './domain/source-adapter.constants';
import type { SourceAdapter } from './domain/source-adapter.interface';
import type { SourceJobQueue } from './domain/source-job-queue.port';
import {
  ARCHIVE_RAW_PAYLOAD_QUEUE_NAME,
  ARCHIVE_RAW_PAYLOAD_QUEUE,
  NORMALIZE_SOURCE_PAYLOAD_QUEUE_NAME,
  NORMALIZE_SOURCE_PAYLOAD_QUEUE,
  UPDATE_MARKET_STATE_QUEUE_NAME,
  UPDATE_MARKET_STATE_QUEUE,
} from './domain/source-ingestion.constants';
import {
  BACKUP_AGGREGATOR_SYNC_QUEUE,
  BACKUP_AGGREGATOR_SYNC_QUEUE_NAME,
  BACKUP_REFERENCE_PROVIDERS,
} from './domain/backup-aggregator.constants';
import {
  BITSKINS_SYNC_QUEUE,
  BITSKINS_SYNC_QUEUE_NAME,
  C5GAME_SYNC_QUEUE,
  C5GAME_SYNC_QUEUE_NAME,
  CSMONEY_SYNC_QUEUE,
  CSMONEY_SYNC_QUEUE_NAME,
  YOUPIN_SYNC_QUEUE,
  YOUPIN_SYNC_QUEUE_NAME,
} from './domain/managed-market.constants';
import {
  STEAM_SNAPSHOT_SYNC_QUEUE,
  STEAM_SNAPSHOT_SYNC_QUEUE_NAME,
} from './domain/steam-snapshot.constants';
import type { BackupReferenceProvider } from './domain/backup-reference-provider.interface';
import type { BackupAggregatorSyncJobData } from './dto/backup-aggregator.job.dto';
import type { ManagedMarketSyncJobData } from './domain/managed-market-source.types';
import {
  CSFLOAT_FETCH_LISTING_DETAIL_QUEUE,
  CSFLOAT_FETCH_LISTING_DETAIL_QUEUE_NAME,
  CSFLOAT_SYNC_LISTINGS_QUEUE,
  CSFLOAT_SYNC_LISTINGS_QUEUE_NAME,
} from './domain/csfloat.constants';
import {
  SKINPORT_INGEST_SALE_FEED_QUEUE,
  SKINPORT_INGEST_SALE_FEED_QUEUE_NAME,
  SKINPORT_SYNC_ITEMS_QUEUE,
  SKINPORT_SYNC_ITEMS_QUEUE_NAME,
  SKINPORT_SYNC_SALES_HISTORY_QUEUE,
  SKINPORT_SYNC_SALES_HISTORY_QUEUE_NAME,
} from './domain/skinport.constants';
import type { ArchiveRawPayloadJobData } from './dto/archive-raw-payload.job.dto';
import type {
  CsFloatListingDetailJobData,
  CsFloatSyncJobData,
} from './dto/csfloat-sync.job.dto';
import type { NormalizeSourcePayloadJobData } from './dto/normalize-source-payload.job.dto';
import type { SteamSnapshotSyncJobData } from './dto/steam-snapshot.job.dto';
import type { UpdateMarketStateJobData } from './dto/update-market-state.job.dto';
import type {
  SkinportSaleFeedJobData,
  SkinportSyncJobData,
} from './dto/skinport-sync.job.dto';
import { BitSkinsSourceAdapter } from './infrastructure/adapters/bitskins-source.adapter';
import { BackupAggregatorSourceAdapter } from './infrastructure/adapters/backup-aggregator-source.adapter';
import { C5GameSourceAdapter } from './infrastructure/adapters/c5game-source.adapter';
import { CSMoneySourceAdapter } from './infrastructure/adapters/csmoney-source.adapter';
import { CsFloatSourceAdapter } from './infrastructure/adapters/csfloat-source.adapter';
import { SkinportSourceAdapter } from './infrastructure/adapters/skinport-source.adapter';
import { SteamSnapshotSourceAdapter } from './infrastructure/adapters/steam-snapshot-source.adapter';
import { YouPinSourceAdapter } from './infrastructure/adapters/youpin-source.adapter';
import { Cs2ShBackupProvider } from './infrastructure/providers/cs2sh-backup.provider';
import { ArchiveRawPayloadProcessor } from './infrastructure/processors/archive-raw-payload.processor';
import { BackupAggregatorSyncProcessor } from './infrastructure/processors/backup-aggregator-sync.processor';
import { BitSkinsSyncProcessor } from './infrastructure/processors/bitskins-sync.processor';
import { C5GameSyncProcessor } from './infrastructure/processors/c5game-sync.processor';
import { CSMoneySyncProcessor } from './infrastructure/processors/csmoney-sync.processor';
import { CsFloatFetchListingDetailProcessor } from './infrastructure/processors/csfloat-fetch-listing-detail.processor';
import { CsFloatSyncListingsProcessor } from './infrastructure/processors/csfloat-sync-listings.processor';
import { NormalizeSourcePayloadProcessor } from './infrastructure/processors/normalize-source-payload.processor';
import { SkinportIngestSaleFeedProcessor } from './infrastructure/processors/skinport-ingest-sale-feed.processor';
import { SkinportSyncItemsProcessor } from './infrastructure/processors/skinport-sync-items.processor';
import { SkinportSyncSalesHistoryProcessor } from './infrastructure/processors/skinport-sync-sales-history.processor';
import { SteamSnapshotSyncProcessor } from './infrastructure/processors/steam-snapshot-sync.processor';
import { UpdateMarketStateProcessor } from './infrastructure/processors/update-market-state.processor';
import { YouPinSyncProcessor } from './infrastructure/processors/youpin-sync.processor';
import { NoopSourceJobQueue } from './infrastructure/queues/noop-source-job.queue';
import { SourceAdapterRegistry } from './infrastructure/registry/source-adapter.registry';
import { DefaultSourceSchedulerService } from './infrastructure/scheduler/default-source-scheduler.service';
import { MarketStateUpdaterService } from './services/market-state-updater.service';
import { RawPayloadArchiveService } from './services/raw-payload-archive.service';
import { SourceAdaptersService } from './services/source-adapters.service';
import { SourceIngestionService } from './services/source-ingestion.service';
import { SourceListingStorageService } from './services/source-listing-storage.service';
import { SourceOperationsService } from './services/source-operations.service';
import { SourcePayloadNormalizationService } from './services/source-payload-normalization.service';
import { SourceRecordService } from './services/source-record.service';
import { SourceAdapterDirectoryService } from './services/source-adapter-directory.service';
import { SourceSyncDispatchService } from './services/source-sync-dispatch.service';
import { BackupAggregatorNamingService } from './services/backup-aggregator-naming.service';
import { BackupAggregatorProviderRegistry } from './services/backup-aggregator-provider.registry';
import { BackupAggregatorRateLimitService } from './services/backup-aggregator-rate-limit.service';
import { BackupAggregatorSyncService } from './services/backup-aggregator-sync.service';
import { BackupAggregatorUniverseService } from './services/backup-aggregator-universe.service';
import { CsFloatCatalogLinkerService } from './services/csfloat-catalog-linker.service';
import { CsFloatDetailPolicyService } from './services/csfloat-detail-policy.service';
import { CsFloatHttpClientService } from './services/csfloat-http-client.service';
import { CsFloatMarketStateService } from './services/csfloat-market-state.service';
import { CsFloatPayloadNormalizerService } from './services/csfloat-payload-normalizer.service';
import { CsFloatRateLimitService } from './services/csfloat-rate-limit.service';
import { CsFloatSyncService } from './services/csfloat-sync.service';
import { ManagedMarketHttpClientService } from './services/managed-market-http-client.service';
import { ManagedMarketNamingService } from './services/managed-market-naming.service';
import { ManagedMarketPayloadNormalizerService } from './services/managed-market-payload-normalizer.service';
import { ManagedMarketSourceDefinitionsService } from './services/managed-market-source-definitions.service';
import { ManagedMarketSourceRuntimeService } from './services/managed-market-source-runtime.service';
import { ManagedMarketSyncService } from './services/managed-market-sync.service';
import { OverlapAwareSourceUniverseService } from './services/overlap-aware-source-universe.service';
import { SkinportCatalogLinkerService } from './services/skinport-catalog-linker.service';
import { SkinportHttpClientService } from './services/skinport-http-client.service';
import { SkinportPayloadNormalizerService } from './services/skinport-payload-normalizer.service';
import { SkinportRateLimitService } from './services/skinport-rate-limit.service';
import { SkinportSaleFeedService } from './services/skinport-sale-feed.service';
import { SkinportSyncService } from './services/skinport-sync.service';
import { SteamSnapshotFallbackService } from './services/steam-snapshot-fallback.service';
import { SteamSnapshotHttpClientService } from './services/steam-snapshot-http-client.service';
import { SteamSnapshotNamingService } from './services/steam-snapshot-naming.service';
import { SteamSnapshotPayloadNormalizerService } from './services/steam-snapshot-payload-normalizer.service';
import { SteamSnapshotRateLimitService } from './services/steam-snapshot-rate-limit.service';
import { SteamSnapshotSyncService } from './services/steam-snapshot-sync.service';
import { SteamSnapshotUniverseService } from './services/steam-snapshot-universe.service';

const isTestEnvironment = process.env.NODE_ENV === 'test';

const sourceIngestionQueueImports = isTestEnvironment
  ? []
  : [
      BullModule.registerQueue(
        {
          name: ARCHIVE_RAW_PAYLOAD_QUEUE_NAME,
          defaultJobOptions: {
            attempts: 3,
            removeOnComplete: 100,
            removeOnFail: 500,
          },
        },
        {
          name: NORMALIZE_SOURCE_PAYLOAD_QUEUE_NAME,
          defaultJobOptions: {
            attempts: 3,
            removeOnComplete: 100,
            removeOnFail: 500,
          },
        },
        {
          name: UPDATE_MARKET_STATE_QUEUE_NAME,
          defaultJobOptions: {
            attempts: 3,
            removeOnComplete: 100,
            removeOnFail: 500,
          },
        },
        {
          name: SKINPORT_SYNC_ITEMS_QUEUE_NAME,
          defaultJobOptions: {
            attempts: 3,
            removeOnComplete: 100,
            removeOnFail: 500,
          },
        },
        {
          name: SKINPORT_SYNC_SALES_HISTORY_QUEUE_NAME,
          defaultJobOptions: {
            attempts: 3,
            removeOnComplete: 100,
            removeOnFail: 500,
          },
        },
        {
          name: SKINPORT_INGEST_SALE_FEED_QUEUE_NAME,
          defaultJobOptions: {
            attempts: 3,
            removeOnComplete: 100,
            removeOnFail: 500,
          },
        },
        {
          name: CSFLOAT_SYNC_LISTINGS_QUEUE_NAME,
          defaultJobOptions: {
            attempts: 3,
            removeOnComplete: 100,
            removeOnFail: 500,
          },
        },
        {
          name: CSFLOAT_FETCH_LISTING_DETAIL_QUEUE_NAME,
          defaultJobOptions: {
            attempts: 3,
            removeOnComplete: 100,
            removeOnFail: 500,
          },
        },
        {
          name: STEAM_SNAPSHOT_SYNC_QUEUE_NAME,
          defaultJobOptions: {
            attempts: 3,
            removeOnComplete: 100,
            removeOnFail: 500,
          },
        },
        {
          name: BACKUP_AGGREGATOR_SYNC_QUEUE_NAME,
          defaultJobOptions: {
            attempts: 3,
            removeOnComplete: 100,
            removeOnFail: 500,
          },
        },
        {
          name: YOUPIN_SYNC_QUEUE_NAME,
          defaultJobOptions: {
            attempts: 3,
            removeOnComplete: 100,
            removeOnFail: 500,
          },
        },
        {
          name: BITSKINS_SYNC_QUEUE_NAME,
          defaultJobOptions: {
            attempts: 3,
            removeOnComplete: 100,
            removeOnFail: 500,
          },
        },
        {
          name: C5GAME_SYNC_QUEUE_NAME,
          defaultJobOptions: {
            attempts: 3,
            removeOnComplete: 100,
            removeOnFail: 500,
          },
        },
        {
          name: CSMONEY_SYNC_QUEUE_NAME,
          defaultJobOptions: {
            attempts: 3,
            removeOnComplete: 100,
            removeOnFail: 500,
          },
        },
      ),
    ];

const sourceIngestionQueueProviders: Provider[] = isTestEnvironment
  ? [
      {
        provide: ARCHIVE_RAW_PAYLOAD_QUEUE,
        useFactory: (): SourceJobQueue<ArchiveRawPayloadJobData> =>
          new NoopSourceJobQueue<ArchiveRawPayloadJobData>(),
      },
      {
        provide: NORMALIZE_SOURCE_PAYLOAD_QUEUE,
        useFactory: (): SourceJobQueue<NormalizeSourcePayloadJobData> =>
          new NoopSourceJobQueue<NormalizeSourcePayloadJobData>(),
      },
      {
        provide: UPDATE_MARKET_STATE_QUEUE,
        useFactory: (): SourceJobQueue<UpdateMarketStateJobData> =>
          new NoopSourceJobQueue<UpdateMarketStateJobData>(),
      },
      {
        provide: SKINPORT_SYNC_ITEMS_QUEUE,
        useFactory: (): SourceJobQueue<SkinportSyncJobData> =>
          new NoopSourceJobQueue<SkinportSyncJobData>(),
      },
      {
        provide: SKINPORT_SYNC_SALES_HISTORY_QUEUE,
        useFactory: (): SourceJobQueue<SkinportSyncJobData> =>
          new NoopSourceJobQueue<SkinportSyncJobData>(),
      },
      {
        provide: SKINPORT_INGEST_SALE_FEED_QUEUE,
        useFactory: (): SourceJobQueue<SkinportSaleFeedJobData> =>
          new NoopSourceJobQueue<SkinportSaleFeedJobData>(),
      },
      {
        provide: CSFLOAT_SYNC_LISTINGS_QUEUE,
        useFactory: (): SourceJobQueue<CsFloatSyncJobData> =>
          new NoopSourceJobQueue<CsFloatSyncJobData>(),
      },
      {
        provide: CSFLOAT_FETCH_LISTING_DETAIL_QUEUE,
        useFactory: (): SourceJobQueue<CsFloatListingDetailJobData> =>
          new NoopSourceJobQueue<CsFloatListingDetailJobData>(),
      },
      {
        provide: STEAM_SNAPSHOT_SYNC_QUEUE,
        useFactory: (): SourceJobQueue<SteamSnapshotSyncJobData> =>
          new NoopSourceJobQueue<SteamSnapshotSyncJobData>(),
      },
      {
        provide: BACKUP_AGGREGATOR_SYNC_QUEUE,
        useFactory: (): SourceJobQueue<BackupAggregatorSyncJobData> =>
          new NoopSourceJobQueue<BackupAggregatorSyncJobData>(),
      },
      {
        provide: YOUPIN_SYNC_QUEUE,
        useFactory: (): SourceJobQueue<ManagedMarketSyncJobData> =>
          new NoopSourceJobQueue<ManagedMarketSyncJobData>(),
      },
      {
        provide: BITSKINS_SYNC_QUEUE,
        useFactory: (): SourceJobQueue<ManagedMarketSyncJobData> =>
          new NoopSourceJobQueue<ManagedMarketSyncJobData>(),
      },
      {
        provide: C5GAME_SYNC_QUEUE,
        useFactory: (): SourceJobQueue<ManagedMarketSyncJobData> =>
          new NoopSourceJobQueue<ManagedMarketSyncJobData>(),
      },
      {
        provide: CSMONEY_SYNC_QUEUE,
        useFactory: (): SourceJobQueue<ManagedMarketSyncJobData> =>
          new NoopSourceJobQueue<ManagedMarketSyncJobData>(),
      },
    ]
  : [
      {
        provide: ARCHIVE_RAW_PAYLOAD_QUEUE,
        inject: [getQueueToken(ARCHIVE_RAW_PAYLOAD_QUEUE_NAME)],
        useFactory: (
          queue: Queue<ArchiveRawPayloadJobData>,
        ): SourceJobQueue<ArchiveRawPayloadJobData> => queue,
      },
      {
        provide: NORMALIZE_SOURCE_PAYLOAD_QUEUE,
        inject: [getQueueToken(NORMALIZE_SOURCE_PAYLOAD_QUEUE_NAME)],
        useFactory: (
          queue: Queue<NormalizeSourcePayloadJobData>,
        ): SourceJobQueue<NormalizeSourcePayloadJobData> => queue,
      },
      {
        provide: UPDATE_MARKET_STATE_QUEUE,
        inject: [getQueueToken(UPDATE_MARKET_STATE_QUEUE_NAME)],
        useFactory: (
          queue: Queue<UpdateMarketStateJobData>,
        ): SourceJobQueue<UpdateMarketStateJobData> => queue,
      },
      {
        provide: SKINPORT_SYNC_ITEMS_QUEUE,
        inject: [getQueueToken(SKINPORT_SYNC_ITEMS_QUEUE_NAME)],
        useFactory: (
          queue: Queue<SkinportSyncJobData>,
        ): SourceJobQueue<SkinportSyncJobData> => queue,
      },
      {
        provide: SKINPORT_SYNC_SALES_HISTORY_QUEUE,
        inject: [getQueueToken(SKINPORT_SYNC_SALES_HISTORY_QUEUE_NAME)],
        useFactory: (
          queue: Queue<SkinportSyncJobData>,
        ): SourceJobQueue<SkinportSyncJobData> => queue,
      },
      {
        provide: SKINPORT_INGEST_SALE_FEED_QUEUE,
        inject: [getQueueToken(SKINPORT_INGEST_SALE_FEED_QUEUE_NAME)],
        useFactory: (
          queue: Queue<SkinportSaleFeedJobData>,
        ): SourceJobQueue<SkinportSaleFeedJobData> => queue,
      },
      {
        provide: CSFLOAT_SYNC_LISTINGS_QUEUE,
        inject: [getQueueToken(CSFLOAT_SYNC_LISTINGS_QUEUE_NAME)],
        useFactory: (
          queue: Queue<CsFloatSyncJobData>,
        ): SourceJobQueue<CsFloatSyncJobData> => queue,
      },
      {
        provide: CSFLOAT_FETCH_LISTING_DETAIL_QUEUE,
        inject: [getQueueToken(CSFLOAT_FETCH_LISTING_DETAIL_QUEUE_NAME)],
        useFactory: (
          queue: Queue<CsFloatListingDetailJobData>,
        ): SourceJobQueue<CsFloatListingDetailJobData> => queue,
      },
      {
        provide: STEAM_SNAPSHOT_SYNC_QUEUE,
        inject: [getQueueToken(STEAM_SNAPSHOT_SYNC_QUEUE_NAME)],
        useFactory: (
          queue: Queue<SteamSnapshotSyncJobData>,
        ): SourceJobQueue<SteamSnapshotSyncJobData> => queue,
      },
      {
        provide: BACKUP_AGGREGATOR_SYNC_QUEUE,
        inject: [getQueueToken(BACKUP_AGGREGATOR_SYNC_QUEUE_NAME)],
        useFactory: (
          queue: Queue<BackupAggregatorSyncJobData>,
        ): SourceJobQueue<BackupAggregatorSyncJobData> => queue,
      },
      {
        provide: YOUPIN_SYNC_QUEUE,
        inject: [getQueueToken(YOUPIN_SYNC_QUEUE_NAME)],
        useFactory: (
          queue: Queue<ManagedMarketSyncJobData>,
        ): SourceJobQueue<ManagedMarketSyncJobData> => queue,
      },
      {
        provide: BITSKINS_SYNC_QUEUE,
        inject: [getQueueToken(BITSKINS_SYNC_QUEUE_NAME)],
        useFactory: (
          queue: Queue<ManagedMarketSyncJobData>,
        ): SourceJobQueue<ManagedMarketSyncJobData> => queue,
      },
      {
        provide: C5GAME_SYNC_QUEUE,
        inject: [getQueueToken(C5GAME_SYNC_QUEUE_NAME)],
        useFactory: (
          queue: Queue<ManagedMarketSyncJobData>,
        ): SourceJobQueue<ManagedMarketSyncJobData> => queue,
      },
      {
        provide: CSMONEY_SYNC_QUEUE,
        inject: [getQueueToken(CSMONEY_SYNC_QUEUE_NAME)],
        useFactory: (
          queue: Queue<ManagedMarketSyncJobData>,
        ): SourceJobQueue<ManagedMarketSyncJobData> => queue,
      },
    ];

const sourceIngestionWorkerProviders: Provider[] = isTestEnvironment
  ? []
  : [
      ArchiveRawPayloadProcessor,
      NormalizeSourcePayloadProcessor,
      UpdateMarketStateProcessor,
      SkinportSyncItemsProcessor,
      SkinportSyncSalesHistoryProcessor,
      SkinportIngestSaleFeedProcessor,
      CsFloatSyncListingsProcessor,
      CsFloatFetchListingDetailProcessor,
      SteamSnapshotSyncProcessor,
      BackupAggregatorSyncProcessor,
      YouPinSyncProcessor,
      BitSkinsSyncProcessor,
      C5GameSyncProcessor,
      CSMoneySyncProcessor,
    ];

@Module({
  imports: [CatalogModule, ...sourceIngestionQueueImports],
  controllers: [SourceAdaptersController],
  providers: [
    SkinportSourceAdapter,
    CsFloatSourceAdapter,
    YouPinSourceAdapter,
    BitSkinsSourceAdapter,
    C5GameSourceAdapter,
    CSMoneySourceAdapter,
    SteamSnapshotSourceAdapter,
    BackupAggregatorSourceAdapter,
    SourceAdapterRegistry,
    SourceAdapterDirectoryService,
    SourceSyncDispatchService,
    SourceAdaptersService,
    SourceIngestionService,
    SourceRecordService,
    RawPayloadArchiveService,
    SourcePayloadNormalizationService,
    SourceListingStorageService,
    MarketStateUpdaterService,
    SourceOperationsService,
    BackupAggregatorNamingService,
    BackupAggregatorRateLimitService,
    BackupAggregatorProviderRegistry,
    BackupAggregatorUniverseService,
    BackupAggregatorSyncService,
    Cs2ShBackupProvider,
    CsFloatRateLimitService,
    CsFloatHttpClientService,
    CsFloatCatalogLinkerService,
    CsFloatPayloadNormalizerService,
    CsFloatDetailPolicyService,
    CsFloatMarketStateService,
    CsFloatSyncService,
    ManagedMarketSourceDefinitionsService,
    ManagedMarketSourceRuntimeService,
    ManagedMarketHttpClientService,
    ManagedMarketPayloadNormalizerService,
    ManagedMarketNamingService,
    OverlapAwareSourceUniverseService,
    ManagedMarketSyncService,
    SkinportRateLimitService,
    SkinportHttpClientService,
    SkinportCatalogLinkerService,
    SkinportPayloadNormalizerService,
    SkinportSyncService,
    SkinportSaleFeedService,
    SteamSnapshotNamingService,
    SteamSnapshotUniverseService,
    SteamSnapshotRateLimitService,
    SteamSnapshotHttpClientService,
    SteamSnapshotFallbackService,
    SteamSnapshotPayloadNormalizerService,
    SteamSnapshotSyncService,
    DefaultSourceSchedulerService,
    ...sourceIngestionQueueProviders,
    ...sourceIngestionWorkerProviders,
    {
      provide: BACKUP_REFERENCE_PROVIDERS,
      inject: [Cs2ShBackupProvider],
      useFactory: (
        cs2ShBackupProvider: Cs2ShBackupProvider,
      ): readonly BackupReferenceProvider[] => [cs2ShBackupProvider],
    },
    {
      provide: SOURCE_ADAPTERS,
      inject: [
        SkinportSourceAdapter,
        CsFloatSourceAdapter,
        YouPinSourceAdapter,
        BitSkinsSourceAdapter,
        C5GameSourceAdapter,
        CSMoneySourceAdapter,
        SteamSnapshotSourceAdapter,
        BackupAggregatorSourceAdapter,
      ],
      useFactory: (
        skinport: SkinportSourceAdapter,
        csfloat: CsFloatSourceAdapter,
        youpin: YouPinSourceAdapter,
        bitskins: BitSkinsSourceAdapter,
        c5game: C5GameSourceAdapter,
        csmoney: CSMoneySourceAdapter,
        steamSnapshot: SteamSnapshotSourceAdapter,
        backupAggregator: BackupAggregatorSourceAdapter,
      ): readonly SourceAdapter[] => [
        skinport,
        csfloat,
        youpin,
        bitskins,
        c5game,
        csmoney,
        steamSnapshot,
        backupAggregator,
      ],
    },
    {
      provide: SOURCE_SCHEDULER,
      useExisting: DefaultSourceSchedulerService,
    },
  ],
  exports: [
    SOURCE_ADAPTERS,
    SOURCE_SCHEDULER,
    SourceAdapterDirectoryService,
    SourceSyncDispatchService,
    SourceIngestionService,
    RawPayloadArchiveService,
    MarketStateUpdaterService,
    SourceOperationsService,
  ],
})
export class SourceAdaptersModule {}
