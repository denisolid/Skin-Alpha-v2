import { NotFoundException } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';

import {
  MARKET_READ_REPOSITORY,
  type MarketSnapshotRecord,
  type MarketReadRepository,
  type MarketStateSourceRecord,
  type MarketStateVariantRecord,
} from '../domain/market-read.repository';
import type { MarketSnapshotHistoryDto } from '../dto/market-snapshot-history.dto';
import { MarketFreshnessPolicyService } from './market-freshness-policy.service';

interface ResolvedFallbackSnapshot {
  readonly snapshot: MarketSnapshotRecord;
}

interface SnapshotObservation {
  readonly ask?: number;
  readonly bid?: number;
  readonly listedQty?: number;
  readonly confidence: number;
}

const DEFAULT_SNAPSHOT_HISTORY_LIMIT = 30;

@Injectable()
export class MarketSnapshotService {
  constructor(
    @Inject(MARKET_READ_REPOSITORY)
    private readonly marketStateRepository: MarketReadRepository,
    @Inject(MarketFreshnessPolicyService)
    private readonly marketFreshnessPolicyService: MarketFreshnessPolicyService,
  ) {}

  async getSnapshotHistory(
    itemVariantId: string,
    limit: number = DEFAULT_SNAPSHOT_HISTORY_LIMIT,
  ): Promise<MarketSnapshotHistoryDto> {
    const generatedAt = new Date();
    const [variantRecord, snapshotHistory] = await Promise.all([
      this.marketStateRepository.findVariantRecord(itemVariantId),
      this.marketStateRepository.findVariantSnapshotHistory(
        itemVariantId,
        limit,
      ),
    ]);

    if (!variantRecord) {
      throw new NotFoundException(
        `Item variant '${itemVariantId}' was not found in market state.`,
      );
    }

    return this.buildSnapshotHistoryDto(
      variantRecord,
      snapshotHistory,
      generatedAt,
    );
  }

  async getVariantSnapshotHistoryRecords(
    itemVariantId: string,
    limit: number,
  ): Promise<readonly MarketSnapshotRecord[]> {
    return this.marketStateRepository.findVariantSnapshotHistory(
      itemVariantId,
      limit,
    );
  }

  async getVariantSnapshotHistoryRecordMap(
    itemVariantIds: readonly string[],
    limit: number,
  ): Promise<ReadonlyMap<string, readonly MarketSnapshotRecord[]>> {
    return this.marketStateRepository.findVariantSnapshotHistories(
      itemVariantIds,
      limit,
    );
  }

  selectHistoricalFallback(
    sourceState: MarketStateSourceRecord,
    snapshotHistory: readonly MarketSnapshotRecord[],
    now: Date,
  ): ResolvedFallbackSnapshot | null {
    for (const snapshot of snapshotHistory) {
      if (snapshot.sourceId !== sourceState.sourceId) {
        continue;
      }

      if (
        sourceState.latestSnapshotId &&
        snapshot.snapshotId === sourceState.latestSnapshotId
      ) {
        continue;
      }

      const observation = this.toSnapshotObservation(snapshot);

      if (!this.hasObservedMarketSignal(observation)) {
        continue;
      }

      const freshness = this.marketFreshnessPolicyService.evaluateSourceState(
        snapshot,
        snapshot.observedAt,
        now,
      );

      if (!freshness.usable) {
        continue;
      }

      return {
        snapshot,
      };
    }

    return null;
  }

  private buildSnapshotHistoryDto(
    variantRecord: MarketStateVariantRecord,
    snapshotHistory: readonly MarketSnapshotRecord[],
    generatedAt: Date,
  ): MarketSnapshotHistoryDto {
    return {
      generatedAt,
      canonicalItemId: variantRecord.canonicalItemId,
      itemVariantId: variantRecord.itemVariantId,
      entries: snapshotHistory.map((snapshot) => {
        const observation = this.toSnapshotObservation(snapshot);
        const freshness = this.marketFreshnessPolicyService.evaluateSourceState(
          snapshot,
          snapshot.observedAt,
          generatedAt,
        );
        const fetchMode = this.marketFreshnessPolicyService.resolveFetchMode(
          snapshot,
          freshness,
          false,
        );

        return {
          snapshotId: snapshot.snapshotId,
          source: snapshot.sourceCode,
          sourceName: snapshot.sourceName,
          ...(observation.ask !== undefined ? { ask: observation.ask } : {}),
          ...(observation.bid !== undefined ? { bid: observation.bid } : {}),
          ...(observation.listedQty !== undefined
            ? { listedQty: observation.listedQty }
            : {}),
          observedAt: snapshot.observedAt,
          freshness,
          confidence: this.marketFreshnessPolicyService.applyConfidencePenalty(
            observation.confidence,
            freshness,
            fetchMode,
          ),
          fetchMode,
          currency: snapshot.currencyCode,
          ...(snapshot.rawPayloadArchiveId
            ? { rawPayloadArchiveId: snapshot.rawPayloadArchiveId }
            : {}),
        };
      }),
    };
  }

  private toSnapshotObservation(
    snapshot: MarketSnapshotRecord,
  ): SnapshotObservation {
    const ask = this.toNumber(snapshot.lowestAskGross);
    const bid = this.toNumber(snapshot.highestBidGross);
    const baseConfidence = this.toNumber(snapshot.confidence);

    return {
      ...(ask !== undefined ? { ask } : {}),
      ...(bid !== undefined ? { bid } : {}),
      ...(snapshot.listingCount !== null && snapshot.listingCount !== undefined
        ? { listedQty: snapshot.listingCount }
        : {}),
      confidence:
        baseConfidence ??
        (ask !== undefined ||
        bid !== undefined ||
        (snapshot.listingCount !== null &&
          snapshot.listingCount !== undefined &&
          snapshot.listingCount > 0)
          ? 0.5
          : 0),
    };
  }

  private hasObservedMarketSignal(observation: SnapshotObservation): boolean {
    return (
      observation.ask !== undefined ||
      observation.bid !== undefined ||
      (observation.listedQty !== undefined && observation.listedQty > 0)
    );
  }

  private toNumber(
    value: { toString(): string } | null | undefined,
  ): number | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }

    const numericValue = Number(value.toString());

    return Number.isFinite(numericValue) ? numericValue : undefined;
  }
}
