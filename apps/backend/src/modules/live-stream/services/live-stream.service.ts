import { createHash, randomUUID } from 'node:crypto';

import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Request } from 'express';
import type Redis from 'ioredis';
import { Subject, type Observable } from 'rxjs';

import { AppLoggerService } from '../../../infrastructure/logging/app-logger.service';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import type { AuthUserRecord } from '../../auth/domain/auth.repository';
import { FeedUserOverlayService } from '../../feed-query/services/feed-user-overlay.service';
import type { SchemeFeedOpportunityDto } from '../../feed-query/dto/scheme-feed.dto';
import {
  MARKET_STATE_CHANGED_CHANNEL,
  type MarketStateChangedEvent,
} from '../../market-state/domain/market-state-change.port';
import type { OpportunityFullFeedItemDto } from '../../opportunities/dto/opportunity-feed.dto';
import { OpportunityFeedService } from '../../opportunities/services/opportunity-feed.service';
import type { CompiledScheme } from '../../schemes/domain/scheme.model';
import { SchemesService } from '../../schemes/services/schemes.service';
import type { GetLiveStreamQueryDto } from '../dto/get-live-stream.query.dto';
import type {
  LiveHeartbeatEventPayloadDto,
  LiveSseMessageEvent,
  LiveStreamEnvelopeDto,
  LiveStreamEventPayloadDto,
  LiveStreamEventType,
  LiveSchemeDescriptorDto,
  LiveSnapshotMode,
} from '../dto/live-stream-event.dto';

const LIVE_RETRY_MS = 3_000;
const LIVE_HEARTBEAT_MS = 15_000;
const LIVE_REFRESH_TICK_MS = 30_000;
const LIVE_REFRESH_DEBOUNCE_MS = 250;
const LIVE_PAGE_SIZE = 100;

type RefreshTrigger = 'initial' | 'market_state_changed' | 'freshness_tick';

interface LiveStreamContext {
  readonly user: Pick<AuthUserRecord, 'id'>;
  readonly query: GetLiveStreamQueryDto;
  readonly request: Request;
  readonly lastEventId?: string;
}

interface LiveSchemeState {
  readonly scheme: LiveSchemeDescriptorDto;
  readonly items: readonly SchemeFeedOpportunityDto[];
  readonly itemVersions: ReadonlyMap<string, string>;
  readonly rankingVersion: string;
}

interface LiveConnection {
  readonly id: string;
  readonly userId: string;
  readonly requestedSchemeIds?: readonly string[];
  readonly subject: Subject<LiveSseMessageEvent>;
  readonly initialSnapshotMode: LiveSnapshotMode;
  readonly schemeStates: Map<string, LiveSchemeState>;
  eventSequence: number;
  refreshTimeout: NodeJS.Timeout | undefined;
  refreshRunning: boolean;
  pendingRefresh: boolean;
  closed: boolean;
}

interface ResolvedConnectionSchemes {
  readonly schemes: readonly CompiledScheme[];
  readonly unavailableSchemeIds: readonly string[];
}

@Injectable()
export class LiveStreamService implements OnModuleInit, OnModuleDestroy {
  private readonly connections = new Map<string, LiveConnection>();
  private redisSubscriber: Redis | undefined;
  private heartbeatInterval: NodeJS.Timeout | undefined;
  private freshnessInterval: NodeJS.Timeout | undefined;

  constructor(
    @Inject(SchemesService)
    private readonly schemesService: SchemesService,
    @Inject(OpportunityFeedService)
    private readonly opportunityFeedService: OpportunityFeedService,
    @Inject(FeedUserOverlayService)
    private readonly feedUserOverlayService: FeedUserOverlayService,
    @Inject(RedisService)
    private readonly redisService: RedisService,
    @Inject(AppLoggerService)
    private readonly logger: AppLoggerService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.initializeRedisSubscriber();
    this.heartbeatInterval = setInterval(() => {
      this.emitHeartbeat();
    }, LIVE_HEARTBEAT_MS);
    this.freshnessInterval = setInterval(() => {
      for (const connection of this.connections.values()) {
        this.scheduleRefresh(connection, 'freshness_tick');
      }
    }, LIVE_REFRESH_TICK_MS);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    if (this.freshnessInterval) {
      clearInterval(this.freshnessInterval);
    }

    for (const connection of this.connections.values()) {
      this.closeConnection(connection.id);
    }

    if (this.redisSubscriber) {
      try {
        await this.redisSubscriber.unsubscribe(MARKET_STATE_CHANGED_CHANNEL);
      } catch {
        // noop
      }

      this.redisSubscriber.disconnect();
      this.redisSubscriber = undefined;
    }
  }

  createStream(context: LiveStreamContext): Observable<LiveSseMessageEvent> {
    const connectionId = randomUUID();
    const connection: LiveConnection = {
      id: connectionId,
      userId: context.user.id,
      ...(context.query.schemeIds
        ? { requestedSchemeIds: [...new Set(context.query.schemeIds)] }
        : {}),
      subject: new Subject<LiveSseMessageEvent>(),
      initialSnapshotMode: context.lastEventId ? 'reset' : 'initial',
      schemeStates: new Map(),
      eventSequence: 0,
      refreshTimeout: undefined,
      refreshRunning: false,
      pendingRefresh: false,
      closed: false,
    };

    this.connections.set(connectionId, connection);
    context.request.on('close', () => {
      this.closeConnection(connectionId);
    });
    this.scheduleRefresh(connection, 'initial', 0);

    return connection.subject.asObservable();
  }

  private async initializeRedisSubscriber(): Promise<void> {
    this.redisSubscriber = this.redisService.getClient().duplicate({
      lazyConnect: true,
      maxRetriesPerRequest: null,
    });
    await this.redisSubscriber.connect();
    this.redisSubscriber.on('message', (channel, message) => {
      if (channel !== MARKET_STATE_CHANGED_CHANNEL) {
        return;
      }

      void this.handleMarketStateChangedMessage(message);
    });
    await this.redisSubscriber.subscribe(MARKET_STATE_CHANGED_CHANNEL);
  }

  private async handleMarketStateChangedMessage(message: string): Promise<void> {
    try {
      const parsed = JSON.parse(message) as {
        readonly events?: readonly MarketStateChangedEvent[];
      };

      if (!parsed.events || parsed.events.length === 0) {
        return;
      }
    } catch (error) {
      this.logger.warn(
        `Failed to parse market-state change message: ${error instanceof Error ? error.message : 'unknown error'}.`,
        LiveStreamService.name,
      );
      return;
    }

    for (const connection of this.connections.values()) {
      this.scheduleRefresh(connection, 'market_state_changed');
    }
  }

  private emitHeartbeat(): void {
    const payload: LiveHeartbeatEventPayloadDto = {
      serverTime: new Date().toISOString(),
      retryMs: LIVE_RETRY_MS,
    };

    for (const connection of this.connections.values()) {
      this.emitEvent(connection, 'heartbeat', payload, {
        retry: LIVE_RETRY_MS,
      });
    }
  }

  private scheduleRefresh(
    connection: LiveConnection,
    trigger: RefreshTrigger,
    delayMs = LIVE_REFRESH_DEBOUNCE_MS,
  ): void {
    if (connection.closed) {
      return;
    }

    if (connection.refreshRunning) {
      connection.pendingRefresh = true;
      return;
    }

    if (connection.refreshTimeout) {
      return;
    }

    connection.refreshTimeout = setTimeout(() => {
      connection.refreshTimeout = undefined;
      void this.refreshConnection(connection.id, trigger);
    }, delayMs);
  }

  private async refreshConnection(
    connectionId: string,
    trigger: RefreshTrigger,
  ): Promise<void> {
    const connection = this.connections.get(connectionId);

    if (!connection || connection.closed) {
      return;
    }

    if (connection.refreshRunning) {
      connection.pendingRefresh = true;
      return;
    }

    connection.refreshRunning = true;

    try {
      const resolved = await this.resolveSchemes(connection);

      if (resolved.unavailableSchemeIds.length > 0) {
        for (const schemeId of resolved.unavailableSchemeIds) {
          this.handleUnavailableScheme(connection, schemeId);
        }
      }

      if (resolved.schemes.length === 0) {
        this.emitEvent(connection, 'resync_required', {
          reason: 'no_live_schemes',
        } satisfies LiveStreamEnvelopeDto<LiveStreamEventPayloadDto>['payload']);
        this.closeConnection(connection.id);
        return;
      }

      const activeSchemeIds = new Set(resolved.schemes.map((scheme) => scheme.id));

      for (const [schemeId] of connection.schemeStates) {
        if (!activeSchemeIds.has(schemeId)) {
          this.handleUnavailableScheme(connection, schemeId);
        }
      }

      for (const scheme of resolved.schemes) {
        await this.refreshScheme(connection, scheme, trigger);
      }
    } catch (error) {
      this.logger.warn(
        `Live stream refresh failed for connection '${connection.id}': ${error instanceof Error ? error.message : 'unknown error'}.`,
        LiveStreamService.name,
      );
      this.emitEvent(connection, 'resync_required', {
        reason: 'refresh_failed',
      } satisfies LiveStreamEnvelopeDto<LiveStreamEventPayloadDto>['payload']);
    } finally {
      connection.refreshRunning = false;

      if (connection.pendingRefresh && !connection.closed) {
        connection.pendingRefresh = false;
        this.scheduleRefresh(connection, trigger);
      }
    }
  }

  private async resolveSchemes(
    connection: LiveConnection,
  ): Promise<ResolvedConnectionSchemes> {
    if (connection.requestedSchemeIds && connection.requestedSchemeIds.length > 0) {
      const results = await Promise.allSettled(
        connection.requestedSchemeIds.map((schemeId) =>
          this.schemesService.getCompiledScheme(schemeId, {
            id: connection.userId,
          }),
        ),
      );
      const schemes: CompiledScheme[] = [];
      const unavailableSchemeIds: string[] = [];

      results.forEach((result, index) => {
        const requestedSchemeId = connection.requestedSchemeIds?.[index];

        if (!requestedSchemeId) {
          return;
        }

        if (result.status !== 'fulfilled') {
          unavailableSchemeIds.push(requestedSchemeId);
          return;
        }

        if (!result.value.liveEnabled || result.value.status !== 'ACTIVE') {
          unavailableSchemeIds.push(requestedSchemeId);
          return;
        }

        schemes.push(result.value);
      });

      return {
        schemes,
        unavailableSchemeIds,
      };
    }

    const schemes = await this.schemesService.listActiveCompiledSchemes({
      id: connection.userId,
    });

    return {
      schemes: schemes.filter((scheme) => scheme.liveEnabled),
      unavailableSchemeIds: [],
    };
  }

  private async refreshScheme(
    connection: LiveConnection,
    scheme: CompiledScheme,
    trigger: RefreshTrigger,
  ): Promise<void> {
    try {
      const snapshot = await this.buildSchemeState(connection.userId, scheme);
      const previousState = connection.schemeStates.get(scheme.id);

      if (!previousState) {
        connection.schemeStates.set(scheme.id, snapshot);
        this.emitEvent(connection, 'snapshot', {
          mode: connection.initialSnapshotMode,
          scheme: snapshot.scheme,
          items: snapshot.items,
          rankingVersion: snapshot.rankingVersion,
          totalVisible: snapshot.items.length,
        });
        return;
      }

      const currentOrder = snapshot.items.map((item) => item.opportunityKey);
      const previousOrder = previousState.items.map((item) => item.opportunityKey);
      const rankingChanged =
        snapshot.rankingVersion !== previousState.rankingVersion ||
        currentOrder.length !== previousOrder.length ||
        currentOrder.some((opportunityKey, index) => opportunityKey !== previousOrder[index]);

      const rankByOpportunityKey = new Map(
        snapshot.items.map((item, index) => [item.opportunityKey, index + 1]),
      );

      for (const item of snapshot.items) {
        const nextVersion = snapshot.itemVersions.get(item.opportunityKey);
        const previousVersion = previousState.itemVersions.get(item.opportunityKey);

        if (!nextVersion || nextVersion === previousVersion) {
          continue;
        }

        this.emitEvent(connection, 'opportunity_upsert', {
          scheme: snapshot.scheme,
          item,
          opportunityVersion: nextVersion,
          rankHint: rankByOpportunityKey.get(item.opportunityKey) ?? snapshot.items.length,
          rankingVersion: snapshot.rankingVersion,
        });
      }

      for (const previousItem of previousState.items) {
        if (snapshot.itemVersions.has(previousItem.opportunityKey)) {
          continue;
        }

        this.emitEvent(connection, 'opportunity_remove', {
          scheme: previousState.scheme,
          opportunityKey: previousItem.opportunityKey,
          reason:
            trigger === 'freshness_tick'
              ? 'expired'
              : 'no_longer_live',
          rankingVersion: snapshot.rankingVersion,
        });
      }

      if (rankingChanged) {
        this.emitEvent(connection, 'ranking_patch', {
          scheme: snapshot.scheme,
          rankingVersion: snapshot.rankingVersion,
          order: snapshot.items.map((item, index) => ({
            opportunityKey: item.opportunityKey,
            rank: index + 1,
          })),
        });
      }

      connection.schemeStates.set(scheme.id, snapshot);
    } catch (error) {
      this.logger.warn(
        `Live stream scheme refresh failed for scheme '${scheme.id}': ${error instanceof Error ? error.message : 'unknown error'}.`,
        LiveStreamService.name,
      );
      this.emitEvent(connection, 'resync_required', {
        reason: 'refresh_failed',
        schemeId: scheme.id,
      });
    }
  }

  private async buildSchemeState(
    userId: string,
    scheme: CompiledScheme,
  ): Promise<LiveSchemeState> {
    const feed = await this.opportunityFeedService.getAllFullFeedForScheme(scheme, {
      page: 1,
      pageSize: LIVE_PAGE_SIZE,
      sortBy: scheme.view.defaultSortBy,
      sortDirection: scheme.view.defaultSortDirection,
    });
    const overlayMap = await this.feedUserOverlayService.resolveOverlayMap(
      userId,
      feed.items,
    );
    const items = feed.items.map((item) => ({
      ...item,
      userState: overlayMap.get(item.opportunityKey) ?? {
        isFavorite: false,
        isBlacklisted: false,
        isMuted: false,
        isPinned: false,
      },
    }));
    const itemVersions = new Map(
      items.map((item) => [item.opportunityKey, this.computeOpportunityVersion(item)]),
    );

    return {
      scheme: {
        id: scheme.id,
        name: scheme.name,
        revision: scheme.revision,
      },
      items,
      itemVersions,
      rankingVersion: this.computeRankingVersion(
        scheme.id,
        scheme.revision,
        items,
      ),
    };
  }

  private handleUnavailableScheme(
    connection: LiveConnection,
    schemeId: string,
  ): void {
    const previousState = connection.schemeStates.get(schemeId);

    if (!previousState) {
      this.emitEvent(connection, 'resync_required', {
        reason: 'scheme_unavailable',
        schemeId,
      });
      return;
    }

    for (const item of previousState.items) {
      this.emitEvent(connection, 'opportunity_remove', {
        scheme: previousState.scheme,
        opportunityKey: item.opportunityKey,
        reason: 'scheme_deactivated',
        rankingVersion: this.computeRankingVersion(
          previousState.scheme.id,
          previousState.scheme.revision,
          [],
        ),
      });
    }

    this.emitEvent(connection, 'ranking_patch', {
      scheme: previousState.scheme,
      rankingVersion: this.computeRankingVersion(
        previousState.scheme.id,
        previousState.scheme.revision,
        [],
      ),
      order: [],
    });
    this.emitEvent(connection, 'resync_required', {
      reason: 'scheme_unavailable',
      schemeId,
    });
    connection.schemeStates.delete(schemeId);
  }

  private emitEvent(
    connection: LiveConnection,
    type: LiveStreamEventType,
    payload: LiveStreamEventPayloadDto,
    options: {
      readonly retry?: number;
    } = {},
  ): void {
    if (connection.closed) {
      return;
    }

    connection.eventSequence += 1;
    const event: LiveSseMessageEvent = {
      id: `${Date.now()}-${connection.eventSequence}`,
      type,
      data: {
        occurredAt: new Date().toISOString(),
        payload,
      } satisfies LiveStreamEnvelopeDto<LiveStreamEventPayloadDto>,
      ...(options.retry !== undefined ? { retry: options.retry } : {}),
    };

    connection.subject.next(event);
  }

  private computeOpportunityVersion(item: SchemeFeedOpportunityDto): string {
    return createHash('sha1')
      .update(JSON.stringify(item))
      .digest('hex');
  }

  private computeRankingVersion(
    schemeId: string,
    schemeRevision: number,
    items: readonly Pick<OpportunityFullFeedItemDto, 'opportunityKey'>[],
  ): string {
    return createHash('sha1')
      .update(
        JSON.stringify({
          schemeId,
          schemeRevision,
          order: items.map((item) => item.opportunityKey),
        }),
      )
      .digest('hex');
  }

  private closeConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);

    if (!connection || connection.closed) {
      return;
    }

    connection.closed = true;

    if (connection.refreshTimeout) {
      clearTimeout(connection.refreshTimeout);
      connection.refreshTimeout = undefined;
    }

    connection.subject.complete();
    this.connections.delete(connectionId);
  }
}
