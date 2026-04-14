import { Cron, CronExpression } from '@nestjs/schedule';
import { Inject, Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../infrastructure/config/app-config.service';
import { AppLoggerService } from '../../../infrastructure/logging/app-logger.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { ReadPathDegradationService } from '../../../infrastructure/redis/read-path-degradation.service';
import type { SourceAdapter } from '../../source-adapters/domain/source-adapter.interface';
import { SOURCE_ADAPTERS } from '../../source-adapters/domain/source-adapter.constants';
import type { SourceAdapterKey } from '../../source-adapters/domain/source-adapter.types';
import type { SourceSchedulerContract } from '../../source-adapters/application/source-scheduler.contract';
import { SOURCE_SCHEDULER } from '../../source-adapters/domain/source-adapter.constants';
import { SourceAntiBanSchedulerService } from '../../source-adapters/services/source-anti-ban-scheduler.service';
import { SourceHealthRecoveryService } from '../../source-adapters/services/source-health-recovery.service';
import { SourceOperationsService } from '../../source-adapters/services/source-operations.service';
import { SourceSyncDispatchService } from '../../source-adapters/services/source-sync-dispatch.service';
import { ScannerUniverseService } from '../../opportunities/services/scanner-universe.service';
import {
  MARKET_STATE_REBUILD_QUEUE_NAME,
  OPPORTUNITY_RESCAN_QUEUE_NAME,
} from '../domain/jobs-scheduler.constants';
import { JobRunService } from './job-run.service';
import { JobsMaintenanceDispatchService } from './jobs-maintenance-dispatch.service';
import { SchedulerLockService } from './scheduler-lock.service';

interface SourceSchedulePlan {
  readonly source: SourceAdapterKey;
  readonly minIntervalMs: number;
}

const SCHEDULER_TICK_LOCK_TTL_MS = 55_000;
const SOURCE_SCHEDULE_LOCK_TTL_MS = 90_000;
const MAINTENANCE_SCHEDULE_LOCK_TTL_MS = 5 * 60 * 1000;
const HOT_UNIVERSE_RESCAN_LIMIT = 80;
const OPPORTUNITY_RESCAN_EMERGENCY_CHANGED_STATES_THRESHOLD = 20_000;
const OPPORTUNITY_RESCAN_BOOTSTRAP_VARIANT_LIMIT = 1_000;

@Injectable()
export class SmartSchedulerService {
  private readonly adaptersByKey: ReadonlyMap<SourceAdapterKey, SourceAdapter>;

  constructor(
    @Inject(AppLoggerService)
    private readonly logger: AppLoggerService,
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(SOURCE_ADAPTERS)
    adapters: readonly SourceAdapter[],
    @Inject(SOURCE_SCHEDULER)
    private readonly sourceScheduler: SourceSchedulerContract,
    @Inject(SourceOperationsService)
    private readonly sourceOperationsService: SourceOperationsService,
    @Inject(SourceHealthRecoveryService)
    private readonly sourceHealthRecoveryService: SourceHealthRecoveryService,
    @Inject(SourceAntiBanSchedulerService)
    private readonly sourceAntiBanSchedulerService: SourceAntiBanSchedulerService,
    @Inject(SourceSyncDispatchService)
    private readonly sourceSyncDispatchService: SourceSyncDispatchService,
    @Inject(JobRunService)
    private readonly jobRunService: JobRunService,
    @Inject(JobsMaintenanceDispatchService)
    private readonly jobsMaintenanceDispatchService: JobsMaintenanceDispatchService,
    @Inject(SchedulerLockService)
    private readonly schedulerLockService: SchedulerLockService,
    @Inject(ReadPathDegradationService)
    private readonly readPathDegradationService: ReadPathDegradationService,
    @Inject(ScannerUniverseService)
    private readonly scannerUniverseService: ScannerUniverseService,
  ) {
    this.adaptersByKey = new Map(
      adapters.map((adapter) => [adapter.descriptor.key, adapter] as const),
    );
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async runTick(): Promise<void> {
    if (!this.configService.schedulerEnabled) {
      return;
    }

    const tickLockAcquired = await this.schedulerLockService.acquire(
      'tick',
      SCHEDULER_TICK_LOCK_TTL_MS,
    );

    if (!tickLockAcquired) {
      this.logger.debug(
        'Skipped scheduler tick because another instance holds the tick lock.',
        SmartSchedulerService.name,
      );

      return;
    }

    const tickStartedAt = new Date();
    this.logger.log(
      `Scheduler tick started at ${tickStartedAt.toISOString()}.`,
      SmartSchedulerService.name,
    );

    for (const plan of this.getSourcePlans()) {
      await this.considerSource(plan, tickStartedAt);
    }

    await this.considerMarketStateRebuild(tickStartedAt);
    await this.considerOpportunityRescan(tickStartedAt);

    this.logger.log(
      `Scheduler tick completed at ${new Date().toISOString()}.`,
      SmartSchedulerService.name,
    );
  }

  private async considerSource(
    plan: SourceSchedulePlan,
    now: Date,
  ): Promise<void> {
    const adapter = this.adaptersByKey.get(plan.source);

    if (!adapter) {
      this.logger.warn(
        `Scheduler considered ${plan.source} but no adapter is registered.`,
        SmartSchedulerService.name,
      );

      return;
    }

    this.logger.debug(
      `Scheduler considered ${plan.source}.`,
      SmartSchedulerService.name,
    );

    if (!adapter.descriptor.priority.enabled) {
      this.logSourceSkip(plan.source, 'disabled_by_config');
      return;
    }

    if (await this.sourceOperationsService.hasActiveSyncJob(plan.source)) {
      this.logSourceSkip(plan.source, 'active_job_exists');
      return;
    }

    const [health, rateLimitState] = await Promise.all([
      adapter.getHealth(),
      adapter.getRateLimitState(),
    ]);
    const runtimeState = await this.sourceHealthRecoveryService.assessAndApply({
      source: plan.source,
      health,
      rateLimitState,
    });

    if (runtimeState.mode === 'disabled' || runtimeState.mode === 'cooldown') {
      this.logSourceSkip(
        plan.source,
        `runtime_guard_${runtimeState.mode}${runtimeState.reason ? ` (${runtimeState.reason})` : ''}`,
      );
      return;
    }

    const scheduleDecision = await this.sourceScheduler.decide({
      adapter: adapter.descriptor,
      health,
      rateLimitState,
      trigger: 'scheduled',
      requestedAt: now,
    });

    if (!scheduleDecision.shouldRun) {
      this.logSourceSkip(plan.source, scheduleDecision.reason);
      return;
    }

    if (
      rateLimitState.status === 'cooldown' ||
      rateLimitState.status === 'blocked'
    ) {
      this.logSourceSkip(
        plan.source,
        `rate_limit_cooldown${rateLimitState.retryAfterSeconds ? ` (${rateLimitState.retryAfterSeconds}s)` : ''}`,
      );
      return;
    }

    if (
      health.consecutiveFailures >= 3 &&
      health.lastFailureAt &&
      now.getTime() - health.lastFailureAt.getTime() <
        this.configService.schedulerFailureCooldownMs
    ) {
      this.logSourceSkip(plan.source, 'failure_cooldown');
      return;
    }

    const effectiveMinIntervalMs = this.resolveEffectiveIntervalMs(
      plan.source,
      plan.minIntervalMs,
      health.status,
      runtimeState.mode,
    );

    if (
      health.lastSuccessfulSyncAt &&
      now.getTime() - health.lastSuccessfulSyncAt.getTime() <
        effectiveMinIntervalMs
    ) {
      this.logSourceSkip(
        plan.source,
        `fresh_enough_until_${new Date(
          health.lastSuccessfulSyncAt.getTime() + effectiveMinIntervalMs,
        ).toISOString()}`,
      );
      return;
    }

    const lockAcquired = await this.schedulerLockService.acquire(
      `source:${plan.source}`,
      SOURCE_SCHEDULE_LOCK_TTL_MS,
    );

    if (!lockAcquired) {
      this.logSourceSkip(plan.source, 'scheduler_lock_unavailable');
      return;
    }

    const accepted = await this.sourceSyncDispatchService.dispatchScheduledSync(
      plan.source,
    );

    this.logger.log(
      `Scheduler enqueued ${plan.source} with ${accepted.acceptedJobs.length} job(s).`,
      SmartSchedulerService.name,
    );
  }

  private async considerMarketStateRebuild(now: Date): Promise<void> {
    this.logger.debug(
      'Scheduler considered market-state rebuild.',
      SmartSchedulerService.name,
    );

    if (!this.configService.schedulerMarketStateRebuildEnabled) {
      this.logger.debug(
        'Scheduler skipped market-state rebuild: disabled_by_config.',
        SmartSchedulerService.name,
      );
      return;
    }

    if (
      await this.jobRunService.hasActiveJob(MARKET_STATE_REBUILD_QUEUE_NAME)
    ) {
      this.logger.debug(
        'Scheduler skipped market-state rebuild: active_job_exists.',
        SmartSchedulerService.name,
      );
      return;
    }

    const lastSuccessfulJob = await this.jobRunService.getLatestSuccessfulJob(
      MARKET_STATE_REBUILD_QUEUE_NAME,
    );

    if (
      lastSuccessfulJob &&
      now.getTime() - lastSuccessfulJob.finishedAt.getTime() <
        this.configService.schedulerMarketStateRebuildMinIntervalMs
    ) {
      this.logger.debug(
        'Scheduler skipped market-state rebuild: interval_not_elapsed.',
        SmartSchedulerService.name,
      );
      return;
    }

    const lockAcquired = await this.schedulerLockService.acquire(
      'market-state-rebuild',
      MAINTENANCE_SCHEDULE_LOCK_TTL_MS,
    );

    if (!lockAcquired) {
      this.logger.debug(
        'Scheduler skipped market-state rebuild: scheduler_lock_unavailable.',
        SmartSchedulerService.name,
      );
      return;
    }

    const result =
      await this.jobsMaintenanceDispatchService.enqueueMarketStateRebuild({
        requestedAt: now,
      });

    this.logger.log(
      `Scheduler enqueued market-state rebuild (${result.externalJobId}).`,
      SmartSchedulerService.name,
    );
  }

  private async considerOpportunityRescan(now: Date): Promise<void> {
    this.logger.debug(
      'Scheduler considered opportunity rescan.',
      SmartSchedulerService.name,
    );

    if (!this.configService.schedulerOpportunityRescanEnabled) {
      this.logger.debug(
        'Scheduler skipped opportunity rescan: disabled_by_config.',
        SmartSchedulerService.name,
      );
      return;
    }

    if (await this.jobRunService.hasActiveJob(OPPORTUNITY_RESCAN_QUEUE_NAME)) {
      this.logger.debug(
        'Scheduler skipped opportunity rescan: active_job_exists.',
        SmartSchedulerService.name,
      );
      return;
    }

    const readPathDegradation = await this.readPathDegradationService.inspect();

    if (readPathDegradation.held) {
      this.logger.warn(
        `Scheduler skipped opportunity rescan: read_path_degraded${readPathDegradation.state?.reason ? ` (${readPathDegradation.state.reason})` : ''}.`,
        SmartSchedulerService.name,
      );
      return;
    }

    const lastSuccessfulJob = await this.jobRunService.getLatestSuccessfulJob(
      OPPORTUNITY_RESCAN_QUEUE_NAME,
    );

    if (
      lastSuccessfulJob &&
      now.getTime() - lastSuccessfulJob.finishedAt.getTime() <
        this.configService.schedulerOpportunityRescanMinIntervalMs
    ) {
      this.logger.debug(
        'Scheduler skipped opportunity rescan: interval_not_elapsed.',
        SmartSchedulerService.name,
      );
      return;
    }

    const changedStateCount = await this.countChangedMarketStatesSince(
      lastSuccessfulJob?.finishedAt,
    );
    const updatedHotItemCount = await this.countUpdatedHotTierItemsSince(
      lastSuccessfulJob?.finishedAt,
    );
    const shouldRunBootstrapRescan =
      !lastSuccessfulJob &&
      changedStateCount >=
        OPPORTUNITY_RESCAN_EMERGENCY_CHANGED_STATES_THRESHOLD;

    if (
      changedStateCount >=
        OPPORTUNITY_RESCAN_EMERGENCY_CHANGED_STATES_THRESHOLD &&
      !shouldRunBootstrapRescan
    ) {
      await this.readPathDegradationService.trip({
        reason: 'opportunity_rescan_overwhelming_delta',
        details: {
          changedStateCount,
          updatedHotItemCount,
        },
      });
      this.logger.warn(
        `Scheduler skipped opportunity rescan: overwhelming_changed_states (changed_states=${changedStateCount}, hot_updates=${updatedHotItemCount}).`,
        SmartSchedulerService.name,
      );
      return;
    }

    if (shouldRunBootstrapRescan) {
      this.logger.warn(
        `Scheduler enqueuing bounded bootstrap opportunity rescan with variant_limit=${OPPORTUNITY_RESCAN_BOOTSTRAP_VARIANT_LIMIT} because no successful baseline exists and changed_states=${changedStateCount} exceeds the emergency threshold.`,
        SmartSchedulerService.name,
      );
    }

    if (
      changedStateCount <
        this.configService.schedulerOpportunityRescanMinChangedStates &&
      updatedHotItemCount <
        this.configService.schedulerOpportunityRescanMinHotUpdates
    ) {
      this.logger.debug(
        `Scheduler skipped opportunity rescan: thresholds_not_met (changed_states=${changedStateCount}, hot_updates=${updatedHotItemCount}).`,
        SmartSchedulerService.name,
      );
      return;
    }

    const lockAcquired = await this.schedulerLockService.acquire(
      'opportunity-rescan',
      MAINTENANCE_SCHEDULE_LOCK_TTL_MS,
    );

    if (!lockAcquired) {
      this.logger.debug(
        'Scheduler skipped opportunity rescan: scheduler_lock_unavailable.',
        SmartSchedulerService.name,
      );
      return;
    }

    const result =
      await this.jobsMaintenanceDispatchService.enqueueOpportunityRescan({
        requestedAt: now,
        changedStateCount,
        updatedHotItemCount,
        ...(shouldRunBootstrapRescan
          ? { variantLimit: OPPORTUNITY_RESCAN_BOOTSTRAP_VARIANT_LIMIT }
          : {}),
      });

    this.logger.log(
      `Scheduler enqueued opportunity rescan (${result.externalJobId}) with changed_states=${changedStateCount} and hot_updates=${updatedHotItemCount}${shouldRunBootstrapRescan ? ` and variant_limit=${OPPORTUNITY_RESCAN_BOOTSTRAP_VARIANT_LIMIT}` : ''}.`,
      SmartSchedulerService.name,
    );
  }

  private async countChangedMarketStatesSince(since?: Date): Promise<number> {
    if (!since) {
      return this.prismaService.marketState.count();
    }

    return this.prismaService.marketState.count({
      where: {
        updatedAt: {
          gt: since,
        },
      },
    });
  }

  private async countUpdatedHotTierItemsSince(since?: Date): Promise<number> {
    const hotUniverse = await this.scannerUniverseService.getScannerUniverse({
      tier: 'hot',
      limit: HOT_UNIVERSE_RESCAN_LIMIT,
    });
    const hotItemVariantIds = hotUniverse.items.map(
      (item) => item.itemVariantId,
    );

    if (hotItemVariantIds.length === 0) {
      return 0;
    }

    const updatedStates = await this.prismaService.marketState.findMany({
      where: {
        itemVariantId: {
          in: hotItemVariantIds,
        },
        ...(since
          ? {
              updatedAt: {
                gt: since,
              },
            }
          : {}),
      },
      distinct: ['itemVariantId'],
      select: {
        itemVariantId: true,
      },
    });

    return updatedStates.length;
  }

  private resolveEffectiveIntervalMs(
    source: SourceAdapterKey,
    baseIntervalMs: number,
    healthStatus: 'unknown' | 'healthy' | 'degraded' | 'down',
    runtimeMode: 'active' | 'degraded' | 'cooldown' | 'disabled',
  ): number {
    const baseWithHealthMultiplier =
      healthStatus === 'down'
        ? Math.round(
            baseIntervalMs *
              this.configService.schedulerDownIntervalMultiplier,
          )
        : healthStatus === 'degraded'
          ? Math.round(
              baseIntervalMs *
                this.configService.schedulerDegradedIntervalMultiplier,
            )
          : baseIntervalMs;

    return this.sourceAntiBanSchedulerService.resolveInterval({
      source,
      baseIntervalMs: baseWithHealthMultiplier,
      healthStatus,
      runtimeMode,
    });
  }

  private getSourcePlans(): readonly SourceSchedulePlan[] {
    return [
      {
        source: 'csfloat',
        minIntervalMs: this.configService.schedulerCsFloatMinIntervalMs,
      },
      {
        source: 'dmarket',
        minIntervalMs: this.configService.schedulerDMarketMinIntervalMs,
      },
      {
        source: 'waxpeer',
        minIntervalMs: this.configService.schedulerWaxpeerMinIntervalMs,
      },
      {
        source: 'steam-snapshot',
        minIntervalMs: this.configService.schedulerSteamSnapshotMinIntervalMs,
      },
      {
        source: 'skinport',
        minIntervalMs: this.configService.schedulerSkinportMinIntervalMs,
      },
      {
        source: 'bitskins',
        minIntervalMs: this.configService.schedulerBitSkinsMinIntervalMs,
      },
      {
        source: 'backup-aggregator',
        minIntervalMs: this.configService.schedulerBackupSourceMinIntervalMs,
      },
    ];
  }

  private logSourceSkip(source: SourceAdapterKey, reason: string): void {
    this.logger.debug(
      `Scheduler skipped ${source}: ${reason}.`,
      SmartSchedulerService.name,
    );
  }
}
