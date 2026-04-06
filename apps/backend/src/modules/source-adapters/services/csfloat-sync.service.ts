import {
  ArchiveEntityType,
  HealthStatus,
  SyncStatus,
  SyncType,
  type Prisma,
} from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../infrastructure/config/app-config.service';
import {
  CSFLOAT_FETCH_LISTING_DETAIL_QUEUE,
  CSFLOAT_FETCH_LISTING_DETAIL_QUEUE_NAME,
  CSFLOAT_LISTING_DETAIL_ENDPOINT_NAME,
  CSFLOAT_LISTINGS_ENDPOINT_NAME,
  CSFLOAT_SYNC_LISTINGS_QUEUE_NAME,
} from '../domain/csfloat.constants';
import type { SourceJobQueue } from '../domain/source-job-queue.port';
import type {
  CsFloatListingDto,
  CsFloatListingsFilterDto,
} from '../dto/csfloat-listing-payload.dto';
import type {
  CsFloatListingDetailJobData,
  CsFloatSyncJobData,
} from '../dto/csfloat-sync.job.dto';
import { RawPayloadArchiveService } from './raw-payload-archive.service';
import { SourceListingStorageService } from './source-listing-storage.service';
import { SourceOperationsService } from './source-operations.service';
import { CsFloatDetailPolicyService } from './csfloat-detail-policy.service';
import {
  CsFloatHttpClientService,
  CsFloatHttpError,
} from './csfloat-http-client.service';
import { CsFloatMarketStateService } from './csfloat-market-state.service';
import { CsFloatPayloadNormalizerService } from './csfloat-payload-normalizer.service';
import { CsFloatRateLimitService } from './csfloat-rate-limit.service';

@Injectable()
export class CsFloatSyncService {
  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
    @Inject(RawPayloadArchiveService)
    private readonly rawPayloadArchiveService: RawPayloadArchiveService,
    @Inject(SourceListingStorageService)
    private readonly sourceListingStorageService: SourceListingStorageService,
    @Inject(SourceOperationsService)
    private readonly sourceOperationsService: SourceOperationsService,
    @Inject(CsFloatDetailPolicyService)
    private readonly csfloatDetailPolicyService: CsFloatDetailPolicyService,
    @Inject(CsFloatHttpClientService)
    private readonly csfloatHttpClientService: CsFloatHttpClientService,
    @Inject(CsFloatMarketStateService)
    private readonly csfloatMarketStateService: CsFloatMarketStateService,
    @Inject(CsFloatPayloadNormalizerService)
    private readonly csfloatPayloadNormalizerService: CsFloatPayloadNormalizerService,
    @Inject(CsFloatRateLimitService)
    private readonly csfloatRateLimitService: CsFloatRateLimitService,
    @Inject(CSFLOAT_FETCH_LISTING_DETAIL_QUEUE)
    private readonly csfloatFetchListingDetailQueue: SourceJobQueue<CsFloatListingDetailJobData>,
  ) {}

  async syncListings(input: CsFloatSyncJobData): Promise<void> {
    const filtersJson = this.serializeFilters(input.filters);
    const jobPayload = this.serializeJson({
      trigger: input.trigger,
      mode: input.mode,
      requestedAt: input.requestedAt,
      ...(input.force !== undefined ? { force: input.force } : {}),
      ...(input.externalJobId ? { externalJobId: input.externalJobId } : {}),
      ...(filtersJson ? { filters: filtersJson } : {}),
      ...(input.pageBudget !== undefined
        ? { pageBudget: input.pageBudget }
        : {}),
      ...(input.detailBudget !== undefined
        ? { detailBudget: input.detailBudget }
        : {}),
    });
    const jobRunId = input.externalJobId
      ? await this.sourceOperationsService.startQueuedJobRun({
          source: 'csfloat',
          queueName: CSFLOAT_SYNC_LISTINGS_QUEUE_NAME,
          jobName: CSFLOAT_SYNC_LISTINGS_QUEUE_NAME,
          externalJobId: input.externalJobId,
          ...(jobPayload ? { payload: jobPayload } : {}),
        })
      : await this.sourceOperationsService.startJobRun({
          source: 'csfloat',
          queueName: CSFLOAT_SYNC_LISTINGS_QUEUE_NAME,
          jobName: CSFLOAT_SYNC_LISTINGS_QUEUE_NAME,
          ...(jobPayload ? { payload: jobPayload } : {}),
        });

    try {
      if (!this.configService.isCsFloatConfigured()) {
        await this.cancelSync(jobRunId, {
          reason: 'csfloat_not_configured',
        });

        return;
      }

      if (!this.isSyncEnabled(input.filters)) {
        await this.cancelSync(jobRunId, {
          reason: 'csfloat_sync_disabled',
        });

        return;
      }

      const startedAt = new Date();
      const pageBudget = Math.max(
        1,
        input.pageBudget ?? this.configService.csfloatListingsPageBudget,
      );
      const detailBudget = Math.max(
        0,
        input.detailBudget ?? this.configService.csfloatDetailJobBudget,
      );
      const normalizedTitles = input.filters?.marketHashName
        ? [input.filters.marketHashName]
        : [];
      const sourceListingIds: string[] = [];
      let detailsEnqueued = 0;
      let pagesFetched = 0;
      let cursor: string | undefined;
      let nextCursor: string | undefined;
      let truncatedByBudget = false;

      await this.sourceOperationsService.upsertSyncStatus({
        source: 'csfloat',
        syncType: SyncType.LISTINGS,
        status: SyncStatus.RUNNING,
        jobRunId,
        details: {
          pageBudget,
          ...(filtersJson ? { filters: filtersJson } : {}),
        } satisfies Prisma.InputJsonValue,
      });

      for (let page = 1; page <= pageBudget; page += 1) {
        const reservation = await this.csfloatRateLimitService.reserve(
          'listings',
          1,
        );

        if (!reservation.granted) {
          truncatedByBudget = true;
          break;
        }

        const requestStartedAt = Date.now();
        const response = await this.csfloatHttpClientService.fetchListingsPage({
          ...(cursor ? { cursor } : {}),
          ...(input.filters ? { filters: input.filters } : {}),
          limit:
            input.filters?.limit ?? this.configService.csfloatListingsPageLimit,
          page,
        });
        const observedAt = new Date();
        const archive = await this.rawPayloadArchiveService.archive({
          source: 'csfloat',
          endpointName: CSFLOAT_LISTINGS_ENDPOINT_NAME,
          observedAt,
          payload: response,
          jobRunId,
          entityType: ArchiveEntityType.SOURCE_SYNC,
          externalId: response.pagination.cursor ?? `page:${page}`,
          contentType: 'application/json',
          httpStatus: 200,
        });
        const normalizedPayload =
          await this.csfloatPayloadNormalizerService.normalize(archive);
        const listingStorageResult =
          await this.sourceListingStorageService.storeNormalizedListings(
            normalizedPayload,
          );

        sourceListingIds.push(...listingStorageResult.sourceListingIds);
        detailsEnqueued += await this.enqueueDetailFetches(
          response.listings,
          detailBudget - detailsEnqueued,
        );
        pagesFetched += 1;
        nextCursor = response.pagination.nextCursor;

        await this.sourceOperationsService.recordHealthMetric({
          source: 'csfloat',
          status: HealthStatus.OK,
          availabilityRatio: 1,
          errorRate: 0,
          latencyMs: Date.now() - requestStartedAt,
          ...(response.rateLimit?.remaining !== undefined
            ? { rateLimitRemaining: response.rateLimit.remaining }
            : {}),
          details: {
            endpointName: CSFLOAT_LISTINGS_ENDPOINT_NAME,
            page,
          } satisfies Prisma.InputJsonValue,
        });

        if (!nextCursor) {
          break;
        }

        cursor = nextCursor;
      }

      const rebuildResult =
        await this.csfloatMarketStateService.reconcileAndRebuild({
          syncStartedAt: startedAt,
          observedAt: new Date(),
          sourceListingIds,
          fullSnapshot: !input.filters,
          ...(normalizedTitles.length > 0 ? { normalizedTitles } : {}),
        });
      const partialResult = truncatedByBudget || Boolean(nextCursor);
      const details = {
        pagesFetched,
        detailsEnqueued,
        rebuiltStateCount: rebuildResult.rebuiltStateCount,
        removedCount: rebuildResult.removedCount,
        ...(filtersJson ? { filters: filtersJson } : {}),
        ...(nextCursor ? { nextCursor } : {}),
      } satisfies Prisma.InputJsonValue;

      await this.sourceOperationsService.completeJobRun({
        jobRunId,
        result: details,
      });
      await this.sourceOperationsService.upsertSyncStatus({
        source: 'csfloat',
        syncType: SyncType.LISTINGS,
        status: partialResult ? SyncStatus.DEGRADED : SyncStatus.SUCCEEDED,
        jobRunId,
        ...(partialResult ? {} : { markSuccessful: true }),
        details,
      });
      await this.sourceOperationsService.recordHealthMetric({
        source: 'csfloat',
        status: partialResult ? HealthStatus.DEGRADED : HealthStatus.OK,
        availabilityRatio: 1,
        errorRate: partialResult ? 0.25 : 0,
        details,
      });
    } catch (error) {
      if (error instanceof CsFloatHttpError && error.statusCode === 429) {
        await this.csfloatRateLimitService.markRateLimited(
          'listings',
          error.retryAfterSeconds,
        );
      }

      await this.sourceOperationsService.failJobRun({
        jobRunId,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.sourceOperationsService.upsertSyncStatus({
        source: 'csfloat',
        syncType: SyncType.LISTINGS,
        status: SyncStatus.FAILED,
        jobRunId,
        markFailed: true,
        details: {
          error:
            error instanceof Error ? error.message : 'Unknown CSFloat error',
        } satisfies Prisma.InputJsonValue,
      });
      await this.sourceOperationsService.recordHealthMetric({
        source: 'csfloat',
        status: HealthStatus.FAILED,
        availabilityRatio: 0,
        errorRate: 1,
        details: {
          error:
            error instanceof Error ? error.message : 'Unknown CSFloat error',
        } satisfies Prisma.InputJsonValue,
      });

      throw error;
    }
  }

  async syncListingDetail(input: CsFloatListingDetailJobData): Promise<void> {
    const jobRunId = await this.sourceOperationsService.startJobRun({
      source: 'csfloat',
      queueName: CSFLOAT_FETCH_LISTING_DETAIL_QUEUE_NAME,
      jobName: CSFLOAT_FETCH_LISTING_DETAIL_QUEUE_NAME,
      payload: {
        listingId: input.listingId,
        reason: input.reason,
      } satisfies Prisma.InputJsonValue,
    });

    try {
      const reservation = await this.csfloatRateLimitService.reserve(
        'listing-detail',
        1,
      );

      if (!reservation.granted) {
        await this.sourceOperationsService.cancelJobRun({
          jobRunId,
          result: {
            reason: 'detail_rate_limit',
            retryAfterSeconds: reservation.retryAfterSeconds ?? null,
          } satisfies Prisma.InputJsonValue,
        });
        await this.sourceOperationsService.recordHealthMetric({
          source: 'csfloat',
          status: HealthStatus.DEGRADED,
          ...(reservation.state.windowRemaining !== undefined
            ? { rateLimitRemaining: reservation.state.windowRemaining }
            : {}),
          details: {
            endpointName: CSFLOAT_LISTING_DETAIL_ENDPOINT_NAME,
            reason: 'detail_rate_limit',
          } satisfies Prisma.InputJsonValue,
        });

        return;
      }

      const requestStartedAt = Date.now();
      const response = await this.csfloatHttpClientService.fetchListingDetail(
        input.listingId,
      );
      const observedAt = new Date();
      const archive = await this.rawPayloadArchiveService.archive({
        source: 'csfloat',
        endpointName: CSFLOAT_LISTING_DETAIL_ENDPOINT_NAME,
        observedAt,
        payload: response,
        externalId: input.listingId,
        entityType: ArchiveEntityType.SOURCE_LISTING,
        jobRunId,
        contentType: 'application/json',
        httpStatus: 200,
      });
      const normalizedPayload =
        await this.csfloatPayloadNormalizerService.normalize(archive);

      await this.sourceListingStorageService.storeNormalizedListings(
        normalizedPayload,
      );
      await this.sourceOperationsService.completeJobRun({
        jobRunId,
        result: {
          listingId: input.listingId,
          reason: input.reason,
        } satisfies Prisma.InputJsonValue,
      });
      await this.sourceOperationsService.recordHealthMetric({
        source: 'csfloat',
        status: HealthStatus.OK,
        availabilityRatio: 1,
        errorRate: 0,
        latencyMs: Date.now() - requestStartedAt,
        ...(response.rateLimit?.remaining !== undefined
          ? { rateLimitRemaining: response.rateLimit.remaining }
          : {}),
        details: {
          endpointName: CSFLOAT_LISTING_DETAIL_ENDPOINT_NAME,
        } satisfies Prisma.InputJsonValue,
      });
    } catch (error) {
      if (error instanceof CsFloatHttpError && error.statusCode === 429) {
        await this.csfloatRateLimitService.markRateLimited(
          'listing-detail',
          error.retryAfterSeconds,
        );
      }

      await this.sourceOperationsService.failJobRun({
        jobRunId,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  private async cancelSync(
    jobRunId: string,
    details: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.sourceOperationsService.cancelJobRun({
      jobRunId,
      result: details,
    });
    await this.sourceOperationsService.upsertSyncStatus({
      source: 'csfloat',
      syncType: SyncType.LISTINGS,
      status: SyncStatus.IDLE,
      jobRunId,
      details,
    });
  }

  private async enqueueDetailFetches(
    listings: readonly CsFloatListingDto[],
    remainingBudget: number,
  ): Promise<number> {
    if (remainingBudget <= 0) {
      return 0;
    }

    let enqueuedCount = 0;

    for (const listing of listings) {
      if (enqueuedCount >= remainingBudget) {
        break;
      }

      const reason = this.csfloatDetailPolicyService.determineReason(listing);

      if (!reason) {
        continue;
      }

      await this.csfloatFetchListingDetailQueue.add(
        CSFLOAT_FETCH_LISTING_DETAIL_QUEUE_NAME,
        {
          listingId: listing.id,
          requestedAt: new Date().toISOString(),
          reason,
        },
        {
          jobId: `csfloat:detail:${listing.id}`,
        },
      );
      enqueuedCount += 1;
    }

    return enqueuedCount;
  }

  private isSyncEnabled(
    filters: CsFloatListingsFilterDto | undefined,
  ): boolean {
    if (filters?.marketHashName) {
      return this.configService.csfloatHotUniverseSyncEnabled;
    }

    return this.configService.csfloatFullSyncEnabled;
  }

  private serializeFilters(
    filters: CsFloatListingsFilterDto | undefined,
  ): Prisma.InputJsonValue | null {
    if (!filters) {
      return null;
    }

    return JSON.parse(JSON.stringify(filters)) as Prisma.InputJsonValue;
  }

  private serializeJson(value: unknown): Prisma.InputJsonValue | null {
    if (value === undefined) {
      return null;
    }

    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
