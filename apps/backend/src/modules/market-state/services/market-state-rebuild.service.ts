import { Inject, Injectable } from '@nestjs/common';

import {
  MARKET_STATE_CHANGE_EMITTER,
  type MarketStateChangedEvent,
  type MarketStateChangeEmitter,
} from '../domain/market-state-change.port';
import {
  MARKET_STATE_WRITE_REPOSITORY,
  type MarketStateWriteRepository,
} from '../domain/market-state-write.repository';
import type { MarketStateRebuildResultDto } from '../dto/market-state-rebuild-result.dto';
import { mapWithConcurrencyLimit } from '../../shared/utils/async.util';

const MARKET_STATE_REBUILD_CONCURRENCY_LIMIT = 6;
const MARKET_STATE_REBUILD_EVENT_CHUNK_SIZE = 500;

@Injectable()
export class MarketStateRebuildService {
  constructor(
    @Inject(MARKET_STATE_WRITE_REPOSITORY)
    private readonly marketStateWriteRepository: MarketStateWriteRepository,
    @Inject(MARKET_STATE_CHANGE_EMITTER)
    private readonly marketStateChangeEmitter: MarketStateChangeEmitter,
  ) {}

  async rebuildLatestStateProjection(): Promise<MarketStateRebuildResultDto> {
    const latestSnapshots =
      await this.marketStateWriteRepository.findLatestSnapshotsForProjection();
    let rebuiltStateCount = 0;
    let unchangedProjectionSkipCount = 0;
    const changedEvents: MarketStateChangedEvent[] = [];

    const projections = await mapWithConcurrencyLimit(
      latestSnapshots,
      MARKET_STATE_REBUILD_CONCURRENCY_LIMIT,
      (snapshot) =>
        this.marketStateWriteRepository.projectLatestStateFromSnapshot(snapshot),
    );

    for (const projection of projections) {
      if (projection.unchangedProjectionSkipped) {
        unchangedProjectionSkipCount += 1;
        continue;
      }
      rebuiltStateCount += 1;

      changedEvents.push({
        source: projection.sourceCode,
        marketStateId: projection.marketStateId,
        latestSnapshotId: projection.latestSnapshotId,
        canonicalItemId: projection.canonicalItemId,
        itemVariantId: projection.itemVariantId,
        observedAt: projection.observedAt,
        ...(projection.rawPayloadArchiveId
          ? { rawPayloadArchiveId: projection.rawPayloadArchiveId }
          : {}),
      });
    }

    await this.emitChangedEventsInChunks(changedEvents);

    return {
      processedSnapshotCount: latestSnapshots.length,
      rebuiltStateCount,
      unchangedProjectionSkipCount,
    };
  }

  private async emitChangedEventsInChunks(
    events: readonly MarketStateChangedEvent[],
  ): Promise<void> {
    if (events.length === 0) {
      return;
    }

    for (let index = 0; index < events.length; index += MARKET_STATE_REBUILD_EVENT_CHUNK_SIZE) {
      await this.marketStateChangeEmitter.emitChanged(
        events.slice(index, index + MARKET_STATE_REBUILD_EVENT_CHUNK_SIZE),
      );
    }
  }
}
