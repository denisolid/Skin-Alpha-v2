import { NotFoundException } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';

import {
  MARKET_STATE_REPOSITORY,
  type MarketSnapshotRecord,
  type MarketStateRepository,
  type MarketStateSourceRecord,
  type MarketStateVariantRecord,
} from '../domain/market-state.repository';
import type {
  CanonicalMarketMatrixDto,
  MergedMarketMatrixDto,
  MergedMarketRowIdentityDto,
  MergedMarketMatrixRowDto,
  MergedMarketVariantIdentityDto,
} from '../dto/merged-market-matrix.dto';
import { MarketFreshnessPolicyService } from './market-freshness-policy.service';
import { MarketSnapshotService } from './market-snapshot.service';
import { MarketSourceConflictService } from './market-source-conflict.service';
import { SourceMarketLinkService } from './source-market-link.service';

interface ResolvedObservation {
  readonly observedAt: Date;
  readonly currency: string;
  readonly ask?: number;
  readonly bid?: number;
  readonly listedQty?: number;
  readonly sourceConfidence: number;
  readonly snapshotId?: string;
  readonly rawPayloadArchiveId?: string;
}

interface JsonRecord {
  [key: string]: unknown;
}

const DEFAULT_FALLBACK_SCAN_LIMIT = 50;

@Injectable()
export class MarketStateMergeService {
  constructor(
    @Inject(MARKET_STATE_REPOSITORY)
    private readonly marketStateRepository: MarketStateRepository,
    @Inject(MarketFreshnessPolicyService)
    private readonly marketFreshnessPolicyService: MarketFreshnessPolicyService,
    @Inject(MarketSnapshotService)
    private readonly marketSnapshotService: MarketSnapshotService,
    @Inject(MarketSourceConflictService)
    private readonly marketSourceConflictService: MarketSourceConflictService,
    @Inject(SourceMarketLinkService)
    private readonly sourceMarketLinkService: SourceMarketLinkService,
  ) {}

  async getVariantMatrix(
    itemVariantId: string,
  ): Promise<MergedMarketMatrixDto> {
    // Scanner-facing reads come from persisted normalized state only.
    const generatedAt = new Date();
    const [variantRecord, snapshotHistory] = await Promise.all([
      this.marketStateRepository.findVariantRecord(itemVariantId),
      this.marketSnapshotService.getVariantSnapshotHistoryRecords(
        itemVariantId,
        DEFAULT_FALLBACK_SCAN_LIMIT,
      ),
    ]);

    if (!variantRecord) {
      throw new NotFoundException(
        `Item variant '${itemVariantId}' was not found in market state.`,
      );
    }

    return this.buildVariantMatrix(variantRecord, snapshotHistory, generatedAt);
  }

  async getCanonicalMatrix(
    canonicalItemId: string,
  ): Promise<CanonicalMarketMatrixDto> {
    const generatedAt = new Date();
    const variantRecords =
      await this.marketStateRepository.findVariantRecordsByCanonicalItem(
        canonicalItemId,
      );

    if (variantRecords.length === 0) {
      throw new NotFoundException(
        `Canonical item '${canonicalItemId}' was not found in market state.`,
      );
    }

    const snapshotHistories = await Promise.all(
      variantRecords.map((variantRecord) =>
        this.marketSnapshotService.getVariantSnapshotHistoryRecords(
          variantRecord.itemVariantId,
          DEFAULT_FALLBACK_SCAN_LIMIT,
        ),
      ),
    );

    return {
      generatedAt,
      canonicalItemId: variantRecords[0]!.canonicalItemId,
      canonicalDisplayName: variantRecords[0]!.canonicalDisplayName,
      category: variantRecords[0]!.category,
      matrices: variantRecords.map((variantRecord, index) =>
        this.buildVariantMatrix(
          variantRecord,
          snapshotHistories[index] ?? [],
          generatedAt,
        ),
      ),
    };
  }

  private buildVariantMatrix(
    variantRecord: MarketStateVariantRecord,
    snapshotHistory: readonly MarketSnapshotRecord[],
    generatedAt: Date,
  ): MergedMarketMatrixDto {
    const provisionalRows = variantRecord.marketStates.map((sourceState) =>
      this.buildRow(variantRecord, sourceState, snapshotHistory, generatedAt),
    );
    const conflictAnalysis =
      this.marketSourceConflictService.analyze(provisionalRows);
    const rows = provisionalRows
      .map((row) => {
        const detail = conflictAnalysis.rowDetails.get(row.source);
        const agreementState = detail?.state;
        const confidenceMultiplier =
          this.marketSourceConflictService.resolveConfidenceMultiplier(
            agreementState,
          );

        return {
          ...row,
          confidence: Number(
            (row.confidence * confidenceMultiplier).toFixed(4),
          ),
          ...(agreementState ? { agreementState } : {}),
          ...(detail
            ? { deviationFromConsensusPercent: detail.deviationPercent }
            : {}),
        };
      })
      .sort((left, right) => this.compareRows(left, right));

    return {
      generatedAt,
      canonicalItemId: variantRecord.canonicalItemId,
      canonicalDisplayName: variantRecord.canonicalDisplayName,
      category: variantRecord.category,
      itemVariantId: variantRecord.itemVariantId,
      variantDisplayName: variantRecord.variantDisplayName,
      variantIdentity: this.buildVariantIdentity(variantRecord),
      rows,
      conflict: conflictAnalysis.summary,
    };
  }

  private buildRow(
    variantRecord: MarketStateVariantRecord,
    sourceState: MarketStateSourceRecord,
    snapshotHistory: readonly MarketSnapshotRecord[],
    now: Date,
  ): MergedMarketMatrixRowDto {
    const currentObservation = this.resolveCurrentObservation(sourceState);
    // Historical fallback is explicit: only reuse the last good snapshot when
    // the latest projected state has lost a usable market signal.
    const shouldAttemptFallback =
      !this.hasObservedMarketSignal(currentObservation);
    const historicalFallback = shouldAttemptFallback
      ? this.marketSnapshotService.selectHistoricalFallback(
          sourceState,
          snapshotHistory,
          now,
        )
      : null;
    const resolvedObservation = historicalFallback
      ? this.resolveSnapshotObservation(historicalFallback.snapshot)
      : currentObservation;
    const freshness = this.marketFreshnessPolicyService.evaluateSourceState(
      sourceState,
      resolvedObservation.observedAt,
      now,
    );
    const links = this.sourceMarketLinkService.resolveLinks({
      sourceCode: sourceState.sourceCode,
      canonicalDisplayName: variantRecord.canonicalDisplayName,
      variantDisplayName: variantRecord.variantDisplayName,
      variantMetadata: variantRecord.variantMetadata,
      representativeListing: sourceState.representativeListing,
    });
    const fetchMode = this.marketFreshnessPolicyService.resolveFetchMode(
      sourceState,
      freshness,
      historicalFallback !== null,
    );
    const identity = sourceState.representativeListing
      ? this.buildRowIdentity(sourceState)
      : undefined;

    return {
      source: sourceState.sourceCode,
      sourceName: sourceState.sourceName,
      ...(links.marketUrl ? { marketUrl: links.marketUrl } : {}),
      ...(links.listingUrl ? { listingUrl: links.listingUrl } : {}),
      ...(resolvedObservation.ask !== undefined
        ? { ask: resolvedObservation.ask }
        : {}),
      ...(resolvedObservation.bid !== undefined
        ? { bid: resolvedObservation.bid }
        : {}),
      ...(resolvedObservation.listedQty !== undefined
        ? { listedQty: resolvedObservation.listedQty }
        : {}),
      observedAt: resolvedObservation.observedAt,
      freshness,
      confidence: this.marketFreshnessPolicyService.applyConfidencePenalty(
        resolvedObservation.sourceConfidence,
        freshness,
        fetchMode,
      ),
      sourceConfidence: resolvedObservation.sourceConfidence,
      fetchMode,
      currency: resolvedObservation.currency,
      ...(resolvedObservation.snapshotId
        ? { snapshotId: resolvedObservation.snapshotId }
        : {}),
      ...(resolvedObservation.rawPayloadArchiveId
        ? { rawPayloadArchiveId: resolvedObservation.rawPayloadArchiveId }
        : {}),
      ...(identity ? { identity } : {}),
    };
  }

  private resolveCurrentObservation(
    sourceState: MarketStateSourceRecord,
  ): ResolvedObservation {
    const latestSnapshot = sourceState.latestSnapshot;
    const ask =
      this.toNumber(sourceState.lowestAskGross) ??
      this.toNumber(latestSnapshot?.lowestAskGross);
    const bid =
      this.toNumber(sourceState.highestBidGross) ??
      this.toNumber(latestSnapshot?.highestBidGross);
    const sourceConfidence =
      this.toNumber(sourceState.confidence) ??
      this.toNumber(latestSnapshot?.confidence) ??
      (ask !== undefined ||
      bid !== undefined ||
      (sourceState.listingCount !== null &&
        sourceState.listingCount !== undefined)
        ? 0.5
        : 0);

    return {
      observedAt: latestSnapshot?.observedAt ?? sourceState.observedAt,
      currency: latestSnapshot?.currencyCode ?? sourceState.currencyCode,
      ...(ask !== undefined ? { ask } : {}),
      ...(bid !== undefined ? { bid } : {}),
      ...(sourceState.listingCount !== null &&
      sourceState.listingCount !== undefined
        ? { listedQty: sourceState.listingCount }
        : latestSnapshot?.listingCount !== null &&
            latestSnapshot?.listingCount !== undefined
          ? { listedQty: latestSnapshot.listingCount }
          : {}),
      sourceConfidence: Number(
        Math.max(0, Math.min(1, sourceConfidence)).toFixed(4),
      ),
      ...(latestSnapshot?.id ? { snapshotId: latestSnapshot.id } : {}),
      ...(latestSnapshot?.rawPayloadArchiveId
        ? { rawPayloadArchiveId: latestSnapshot.rawPayloadArchiveId }
        : {}),
    };
  }

  private resolveSnapshotObservation(
    snapshot: MarketSnapshotRecord,
  ): ResolvedObservation {
    const ask = this.toNumber(snapshot.lowestAskGross);
    const bid = this.toNumber(snapshot.highestBidGross);
    const sourceConfidence =
      this.toNumber(snapshot.confidence) ??
      (ask !== undefined ||
      bid !== undefined ||
      (snapshot.listingCount !== null && snapshot.listingCount !== undefined)
        ? 0.5
        : 0);

    return {
      observedAt: snapshot.observedAt,
      currency: snapshot.currencyCode,
      ...(ask !== undefined ? { ask } : {}),
      ...(bid !== undefined ? { bid } : {}),
      ...(snapshot.listingCount !== null && snapshot.listingCount !== undefined
        ? { listedQty: snapshot.listingCount }
        : {}),
      sourceConfidence: Number(
        Math.max(0, Math.min(1, sourceConfidence)).toFixed(4),
      ),
      snapshotId: snapshot.snapshotId,
      ...(snapshot.rawPayloadArchiveId
        ? { rawPayloadArchiveId: snapshot.rawPayloadArchiveId }
        : {}),
    };
  }

  private hasObservedMarketSignal(observation: ResolvedObservation): boolean {
    return (
      observation.ask !== undefined ||
      observation.bid !== undefined ||
      observation.listedQty !== undefined
    );
  }

  private compareRows(
    left: MergedMarketMatrixRowDto,
    right: MergedMarketMatrixRowDto,
  ): number {
    const fetchModeOrder =
      this.rankFetchMode(left.fetchMode) - this.rankFetchMode(right.fetchMode);

    if (fetchModeOrder !== 0) {
      return fetchModeOrder;
    }

    if (left.confidence !== right.confidence) {
      return right.confidence - left.confidence;
    }

    if (
      left.ask !== undefined &&
      right.ask !== undefined &&
      left.ask !== right.ask
    ) {
      return left.ask - right.ask;
    }

    return left.sourceName.localeCompare(right.sourceName);
  }

  private rankFetchMode(
    fetchMode: MergedMarketMatrixRowDto['fetchMode'],
  ): number {
    switch (fetchMode) {
      case 'live':
        return 0;
      case 'snapshot':
        return 1;
      case 'fallback':
        return 2;
      case 'backup':
        return 3;
    }
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

  private buildVariantIdentity(
    variantRecord: MarketStateVariantRecord,
  ): MergedMarketVariantIdentityDto {
    const metadata = this.readJsonObject(variantRecord.variantMetadata);
    const mapping = this.readJsonObject(metadata.mapping);
    const marketHashName = this.readString(metadata.marketHashName);
    const exterior = this.readString(mapping.exterior);
    const phaseLabel = this.readString(mapping.phaseLabel);
    const mappingConfidence =
      this.readNumber(mapping.confidence) ??
      this.readNumber(metadata.confidence) ??
      0.5;
    const defIndex = this.readNumber(mapping.defIndex);
    const paintIndex = this.readNumber(mapping.paintIndex);

    return {
      ...(marketHashName ? { marketHashName } : {}),
      ...(exterior ? { exterior } : {}),
      ...(phaseLabel ? { phaseLabel } : {}),
      stattrak: this.readBoolean(mapping.stattrak) ?? false,
      souvenir: this.readBoolean(mapping.souvenir) ?? false,
      isVanilla: this.readBoolean(mapping.isVanilla) ?? false,
      patternRelevant:
        this.readBoolean(mapping.isReferencePatternRelevant) ?? false,
      floatRelevant:
        this.readBoolean(mapping.isReferenceFloatRelevant) ?? false,
      mappingConfidence: Number(mappingConfidence.toFixed(4)),
      ...(defIndex !== undefined ? { defIndex } : {}),
      ...(paintIndex !== undefined ? { paintIndex } : {}),
    };
  }

  private buildRowIdentity(
    sourceState: MarketStateSourceRecord,
  ): MergedMarketRowIdentityDto {
    const representativeListing = sourceState.representativeListing;

    if (!representativeListing) {
      return {
        hasSellerMetadata: false,
        hasScmHints: false,
      };
    }

    const attributes = this.readJsonObject(representativeListing.attributes);
    const listingMetadata = this.readJsonObject(attributes.metadata);
    const stickers = Array.isArray(listingMetadata.stickers)
      ? listingMetadata.stickers
      : [];
    const scmHints = this.readJsonObject(listingMetadata.scm);
    const sellerMetadata = this.readJsonObject(listingMetadata.seller);
    const condition = this.readString(attributes.condition);
    const phase = this.readString(attributes.phase);
    const paintSeed = this.readNumber(attributes.paintSeed);
    const wearFloat = this.readNumber(attributes.wearFloat);
    const isStatTrak = this.readBoolean(attributes.isStatTrak);
    const isSouvenir = this.readBoolean(attributes.isSouvenir);

    return {
      representativeListingId: representativeListing.id,
      externalListingId: representativeListing.externalListingId,
      title: representativeListing.title,
      ...(condition ? { condition } : {}),
      ...(phase ? { phase } : {}),
      ...(paintSeed !== undefined ? { paintSeed } : {}),
      ...(wearFloat !== undefined ? { wearFloat } : {}),
      ...(isStatTrak !== undefined ? { isStatTrak } : {}),
      ...(isSouvenir !== undefined ? { isSouvenir } : {}),
      ...(stickers.length > 0 ? { stickerCount: stickers.length } : {}),
      hasSellerMetadata: Object.keys(sellerMetadata).length > 0,
      hasScmHints: Object.keys(scmHints).length > 0,
    };
  }

  private readJsonObject(value: unknown): JsonRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as JsonRecord;
  }

  private readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : undefined;
  }

  private readBoolean(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
  }

  private readNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      const parsedValue = Number(value);

      return Number.isFinite(parsedValue) ? parsedValue : undefined;
    }

    return undefined;
  }
}
