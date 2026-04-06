import { HealthStatus, SyncType } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../infrastructure/config/app-config.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { SourceHealthModel } from '../domain/source-health.model';
import type { SteamSnapshotFreshnessDto } from '../dto/steam-snapshot.dto';
import { SourceOperationsService } from './source-operations.service';
import { SourceRecordService } from './source-record.service';

interface SteamSnapshotFailureDisposition {
  readonly healthStatus: HealthStatus;
  readonly fallbackUsable: boolean;
  readonly freshness: SteamSnapshotFreshnessDto;
}

@Injectable()
export class SteamSnapshotFallbackService {
  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(SourceOperationsService)
    private readonly sourceOperationsService: SourceOperationsService,
    @Inject(SourceRecordService)
    private readonly sourceRecordService: SourceRecordService,
  ) {}

  async getFreshness(): Promise<SteamSnapshotFreshnessDto> {
    const steamSource =
      await this.sourceRecordService.resolveByKey('steam-snapshot');
    const [syncStatus, latestMarketState] = await Promise.all([
      this.sourceOperationsService.getLatestSyncStatus(
        'steam-snapshot',
        SyncType.MARKET_STATE,
      ),
      this.prismaService.marketState.findFirst({
        where: {
          sourceId: steamSource.id,
        },
        select: {
          observedAt: true,
        },
        orderBy: {
          observedAt: 'desc',
        },
      }),
    ]);
    const lastGoodSnapshotAt = latestMarketState?.observedAt ?? null;
    const lagMs = lastGoodSnapshotAt
      ? Date.now() - lastGoodSnapshotAt.getTime()
      : undefined;
    const fresh =
      lagMs !== undefined &&
      lagMs <= this.configService.steamSnapshotStaleAfterMs;
    const fallbackUsable =
      lagMs !== undefined &&
      lagMs <= this.configService.steamSnapshotMaxStaleMs;

    return {
      ...(syncStatus?.lastSuccessfulAt
        ? { lastSuccessfulSyncAt: syncStatus.lastSuccessfulAt }
        : {}),
      ...(lastGoodSnapshotAt ? { lastGoodSnapshotAt } : {}),
      ...(lagMs !== undefined ? { lagMs } : {}),
      fresh,
      fallbackUsable,
      confidencePenalty: this.computeConfidencePenalty(lagMs),
    };
  }

  async getSourceHealth(): Promise<SourceHealthModel> {
    const [baseHealth, freshness] = await Promise.all([
      this.sourceOperationsService.getSourceHealth('steam-snapshot'),
      this.getFreshness(),
    ]);

    const status = freshness.lastGoodSnapshotAt
      ? freshness.fresh
        ? baseHealth.status === 'down'
          ? 'degraded'
          : baseHealth.status
        : freshness.fallbackUsable
          ? 'degraded'
          : 'down'
      : baseHealth.status;

    return {
      ...baseHealth,
      status,
      ...(freshness.lastSuccessfulSyncAt
        ? { lastSuccessfulSyncAt: freshness.lastSuccessfulSyncAt }
        : {}),
      detail: JSON.stringify({
        freshness,
      }),
    };
  }

  async resolveFailureDisposition(): Promise<SteamSnapshotFailureDisposition> {
    const freshness = await this.getFreshness();

    return {
      healthStatus: freshness.fallbackUsable
        ? HealthStatus.DEGRADED
        : HealthStatus.FAILED,
      fallbackUsable: freshness.fallbackUsable,
      freshness,
    };
  }

  buildSnapshotMetadata(observedAt: Date): {
    freshnessState: 'fresh' | 'stale' | 'expired';
    sourceLagMs: number;
    staleAfterMinutes: number;
    maxStaleMinutes: number;
    confidencePenalty: number;
  } {
    const lagMs = Math.max(0, Date.now() - observedAt.getTime());

    return {
      freshnessState:
        lagMs <= this.configService.steamSnapshotStaleAfterMs
          ? 'fresh'
          : lagMs <= this.configService.steamSnapshotMaxStaleMs
            ? 'stale'
            : 'expired',
      sourceLagMs: lagMs,
      staleAfterMinutes: this.configService.steamSnapshotStaleAfterMinutes,
      maxStaleMinutes: this.configService.steamSnapshotMaxStaleMinutes,
      confidencePenalty: this.computeConfidencePenalty(lagMs),
    };
  }

  private computeConfidencePenalty(lagMs: number | undefined): number {
    if (lagMs === undefined) {
      return 0.5;
    }

    if (lagMs <= this.configService.steamSnapshotStaleAfterMs) {
      return 0;
    }

    if (lagMs >= this.configService.steamSnapshotMaxStaleMs) {
      return 0.5;
    }

    return Number(
      (
        ((lagMs - this.configService.steamSnapshotStaleAfterMs) /
          Math.max(
            1,
            this.configService.steamSnapshotMaxStaleMs -
              this.configService.steamSnapshotStaleAfterMs,
          )) *
        0.5
      ).toFixed(4),
    );
  }
}
