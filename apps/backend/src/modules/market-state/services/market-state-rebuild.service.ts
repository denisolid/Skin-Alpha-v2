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
    const changedEvents: MarketStateChangedEvent[] = [];

    for (const snapshot of latestSnapshots) {
      const projection =
        await this.marketStateWriteRepository.projectLatestStateFromSnapshot(
          snapshot,
        );

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

    await this.marketStateChangeEmitter.emitChanged(changedEvents);

    return {
      processedSnapshotCount: latestSnapshots.length,
      rebuiltStateCount,
    };
  }
}
