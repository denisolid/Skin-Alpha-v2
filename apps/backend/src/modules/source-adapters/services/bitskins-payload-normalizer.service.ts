import { Inject, Injectable, Optional } from '@nestjs/common';

import { CatalogAliasNormalizationService } from '../../catalog/services/catalog-alias-normalization.service';
import { BITSKINS_LISTINGS_ENDPOINT_NAME } from '../domain/managed-market.constants';
import type { ManagedMarketTargetDto } from '../domain/managed-market-source.types';
import type { ArchivedRawPayloadDto } from '../dto/archived-raw-payload.dto';
import type {
  BitSkinsMarketItemDto,
  BitSkinsMarketSnapshotDto,
} from '../dto/bitskins-market-item.dto';
import type { NormalizedMarketListingDto } from '../dto/normalized-market-listing.dto';
import type { NormalizedMarketStateDto } from '../dto/normalized-market-state.dto';
import type { NormalizedSourcePayloadDto } from '../dto/normalized-source-payload.dto';
import {
  BitSkinsCatalogLinkerService,
  type ResolveBitSkinsListingInput,
} from './bitskins-catalog-linker.service';

interface AggregatedBitSkinsRow {
  readonly skinId?: number;
  readonly name: string;
  readonly priceMinMinor?: number;
  readonly priceMaxMinor?: number;
  readonly priceAvgMinor?: number;
  readonly quantity: number;
}

interface TargetHints {
  readonly canonicalItemId: string;
  readonly itemVariantId: string;
  readonly marketHashName: string;
}

@Injectable()
export class BitSkinsPayloadNormalizerService {
  constructor(
    @Inject(BitSkinsCatalogLinkerService)
    private readonly bitSkinsCatalogLinkerService: BitSkinsCatalogLinkerService,
    @Optional()
    @Inject(CatalogAliasNormalizationService)
    private readonly aliasNormalizationService: CatalogAliasNormalizationService = new CatalogAliasNormalizationService(),
  ) {}

  async normalize(
    archive: ArchivedRawPayloadDto,
  ): Promise<NormalizedSourcePayloadDto> {
    if (archive.endpointName !== BITSKINS_LISTINGS_ENDPOINT_NAME) {
      return {
        rawPayloadArchiveId: archive.id,
        source: archive.source,
        endpointName: archive.endpointName,
        observedAt: archive.observedAt,
        payloadHash: archive.payloadHash,
        listings: [],
        marketStates: [],
        warnings: [`Unsupported BitSkins endpoint ${archive.endpointName}.`],
      };
    }

    const payload = this.isEnvelope(archive.payload) ? archive.payload : null;

    if (!payload) {
      return {
        rawPayloadArchiveId: archive.id,
        source: archive.source,
        endpointName: archive.endpointName,
        observedAt: archive.observedAt,
        payloadHash: archive.payloadHash,
        listings: [],
        marketStates: [],
        warnings: ['Invalid BitSkins market snapshot payload.'],
      };
    }

    const targets = this.readTargetHints(archive.requestMeta);

    if (targets.length === 0) {
      return {
        rawPayloadArchiveId: archive.id,
        source: archive.source,
        endpointName: archive.endpointName,
        observedAt: archive.observedAt,
        payloadHash: archive.payloadHash,
        listings: [],
        marketStates: [],
        warnings: [
          'BitSkins normalization requires overlap target hints to keep processing bounded.',
        ],
      };
    }

    const aggregateByName = this.aggregateRowsByName(payload.list);
    const matchedTargets: Array<{
      readonly target: TargetHints;
      readonly row: AggregatedBitSkinsRow;
    }> = [];
    const missingTargets: TargetHints[] = [];

    for (const target of targets) {
      const row = aggregateByName.get(
        this.normalizeLookupKey(target.marketHashName),
      );

      if (!row) {
        missingTargets.push(target);
        continue;
      }

      matchedTargets.push({
        target,
        row,
      });
    }

    const runContext = this.bitSkinsCatalogLinkerService.createRunContext();
    const resolutionInputs = matchedTargets.map(({ target, row }) =>
      this.buildResolutionInput(target, row),
    );
    const resolutions =
      await this.bitSkinsCatalogLinkerService.resolveOrCreateMany(
        resolutionInputs,
        runContext,
      );
    const listings: NormalizedMarketListingDto[] = [];
    const marketStates: NormalizedMarketStateDto[] = [];
    const mappingSignals: Array<
      NonNullable<NormalizedSourcePayloadDto['mappingSignals']>[number]
    > = [];
    const warnings: string[] = [];
    let unresolvedCount = 0;

    matchedTargets.forEach(({ target, row }, index) => {
      const resolution = resolutions[index];
      const resolutionInput = resolutionInputs[index];

      if (!resolution || !resolutionInput) {
        return;
      }

      if (
        resolution.status !== 'resolved' ||
        !resolution.canonicalItemId ||
        !resolution.itemVariantId
      ) {
        unresolvedCount += 1;
        warnings.push(this.buildUnresolvedWarning(row.name, resolution));
        mappingSignals.push({
          kind: 'listing',
          sourceItemId:
            row.skinId !== undefined ? String(row.skinId) : target.itemVariantId,
          title: row.name,
          observedAt: archive.observedAt,
          resolutionNote: this.buildUnresolvedWarning(row.name, resolution),
          variantHints: this.buildMappingHints(resolutionInput),
          metadata: {
            resolutionReason: resolution.reason ?? null,
            warnings: [...resolution.warnings],
            targetCanonicalItemId: target.canonicalItemId,
            targetItemVariantId: target.itemVariantId,
          },
        });
        return;
      }

      if (!row.priceMinMinor || row.priceMinMinor <= 0) {
        warnings.push(
          `BitSkins market row "${row.name}" is missing a usable minimum ask.`,
        );
        marketStates.push(
          this.buildMissingMarketState(
            target,
            archive.observedAt,
            'invalid_price',
          ),
        );
        return;
      }

      const quantityAvailable = Math.max(0, row.quantity);

      marketStates.push(
        this.buildMarketState({
          canonicalItemId: resolution.canonicalItemId,
          itemVariantId: resolution.itemVariantId,
          observedAt: archive.observedAt,
          row,
        }),
      );

      if (quantityAvailable <= 0) {
        return;
      }

      listings.push({
        source: archive.source,
        externalListingId:
          row.skinId !== undefined
            ? `bitskins:${row.skinId}`
            : `bitskins:${resolution.itemVariantId}`,
        sourceItemId:
          row.skinId !== undefined
            ? String(row.skinId)
            : resolution.itemVariantId,
        canonicalItemId: resolution.canonicalItemId,
        itemVariantId: resolution.itemVariantId,
        title: row.name,
        observedAt: archive.observedAt,
        currency: 'USD',
        priceMinor: row.priceMinMinor,
        quantityAvailable,
        ...(resolutionInput.exterior
          ? { condition: resolutionInput.exterior }
          : {}),
        ...(resolutionInput.phaseHint ? { phase: resolutionInput.phaseHint } : {}),
        isStatTrak: resolutionInput.isStatTrak ?? false,
        isSouvenir: resolutionInput.isSouvenir ?? false,
        metadata: {
          skinId: row.skinId ?? null,
          priceAvgMinor: row.priceAvgMinor ?? null,
          priceMaxMinor: row.priceMaxMinor ?? null,
          targetMarketHashName: target.marketHashName,
          resolvedBy: resolution.reason ?? 'catalog',
        },
      });
    });

    for (const target of missingTargets) {
      marketStates.push(
        this.buildMissingMarketState(
          target,
          archive.observedAt,
          'missing_from_snapshot',
        ),
      );
    }

    if (missingTargets.length > 0) {
      warnings.push(
        `BitSkins snapshot did not contain ${missingTargets.length} targeted rows. Samples: ${missingTargets
          .slice(0, 5)
          .map((target) => target.marketHashName)
          .join(', ')}.`,
      );
    }

    if (unresolvedCount > 0) {
      warnings.push(
        `BitSkins catalog resolution stayed unresolved for ${unresolvedCount} targeted rows.`,
      );
    }

    return {
      rawPayloadArchiveId: archive.id,
      source: archive.source,
      endpointName: archive.endpointName,
      observedAt: archive.observedAt,
      payloadHash: archive.payloadHash,
      listings,
      marketStates,
      ...(mappingSignals.length > 0 ? { mappingSignals } : {}),
      warnings,
    };
  }

  private buildResolutionInput(
    target: TargetHints,
    row: AggregatedBitSkinsRow,
  ): ResolveBitSkinsListingInput {
    const phaseHint = this.aliasNormalizationService.normalizePhaseHint(row.name);
    const exterior =
      this.aliasNormalizationService.extractExteriorFromTitle(row.name);

    return {
      marketHashName: row.name,
      ...(exterior ? { exterior } : {}),
      isStatTrak: this.detectStatTrak(row.name),
      isSouvenir: this.detectSouvenir(row.name),
      ...(phaseHint ? { phaseHint } : {}),
      targetCanonicalItemId: target.canonicalItemId,
      targetItemVariantId: target.itemVariantId,
    };
  }

  private buildMarketState(input: {
    readonly canonicalItemId: string;
    readonly itemVariantId: string;
    readonly observedAt: Date;
    readonly row: AggregatedBitSkinsRow;
  }): NormalizedMarketStateDto {
    const quantity = Math.max(0, input.row.quantity);
    const anchorMinor = input.row.priceAvgMinor ?? input.row.priceMinMinor;

    return {
      source: 'bitskins',
      canonicalItemId: input.canonicalItemId,
      itemVariantId: input.itemVariantId,
      capturedAt: input.observedAt,
      currency: 'USD',
      listingCount: quantity,
      ...(input.row.priceMinMinor !== undefined
        ? { lowestAskMinor: input.row.priceMinMinor }
        : {}),
      ...(anchorMinor !== undefined ? { average24hMinor: anchorMinor } : {}),
      ...(anchorMinor !== undefined ? { lastTradeMinor: anchorMinor } : {}),
      sampleSize: 1,
      confidence:
        quantity > 0 ? this.deriveConfidence(quantity, anchorMinor !== undefined) : 0,
      liquidityScore: quantity > 0 ? this.deriveLiquidityScore(quantity) : 0,
      metadata: {
        aggregatedFrom: 'bitskins-market-insell',
        skinId: input.row.skinId ?? null,
        priceAvgMinor: input.row.priceAvgMinor ?? null,
        priceMaxMinor: input.row.priceMaxMinor ?? null,
        quantity,
      },
    };
  }

  private buildMissingMarketState(
    target: TargetHints,
    observedAt: Date,
    reason: string,
  ): NormalizedMarketStateDto {
    return {
      source: 'bitskins',
      canonicalItemId: target.canonicalItemId,
      itemVariantId: target.itemVariantId,
      capturedAt: observedAt,
      currency: 'USD',
      listingCount: 0,
      confidence: 0,
      liquidityScore: 0,
      metadata: {
        aggregatedFrom: 'bitskins-market-insell',
        targetStatus: reason,
        targetMarketHashName: target.marketHashName,
      },
    };
  }

  private aggregateRowsByName(
    items: readonly BitSkinsMarketItemDto[],
  ): ReadonlyMap<string, AggregatedBitSkinsRow> {
    const aggregatedRows = new Map<string, AggregatedBitSkinsRow>();

    for (const item of items) {
      const name = item.name?.trim();

      if (!name) {
        continue;
      }

      const normalizedName =
        this.aliasNormalizationService.normalizeMarketHashName(name);
      const key = this.normalizeLookupKey(normalizedName);
      const currentRow = aggregatedRows.get(key);
      const quantity = Math.max(0, this.toMinor(item.quantity) ?? 0);
      const priceMinMinor = this.toMinor(item.price_min);
      const priceMaxMinor = this.toMinor(item.price_max);
      const priceAvgMinor = this.toMinor(item.price_avg);

      if (!currentRow) {
        aggregatedRows.set(key, {
          ...(item.skin_id !== undefined ? { skinId: item.skin_id } : {}),
          name: normalizedName,
          ...(priceMinMinor !== undefined ? { priceMinMinor } : {}),
          ...(priceMaxMinor !== undefined ? { priceMaxMinor } : {}),
          ...(priceAvgMinor !== undefined ? { priceAvgMinor } : {}),
          quantity,
        });
        continue;
      }

      const totalQuantity = currentRow.quantity + quantity;
      const weightedAverageMinor =
        currentRow.priceAvgMinor !== undefined || priceAvgMinor !== undefined
          ? Math.round(
              ((currentRow.priceAvgMinor ?? currentRow.priceMinMinor ?? 0) *
                currentRow.quantity +
                (priceAvgMinor ?? priceMinMinor ?? 0) * quantity) /
                Math.max(1, totalQuantity),
            )
          : undefined;

      aggregatedRows.set(key, {
        ...(currentRow.skinId !== undefined || item.skin_id !== undefined
          ? {
              skinId: currentRow.skinId ?? item.skin_id!,
            }
          : {}),
        name: currentRow.name,
        ...(currentRow.priceMinMinor !== undefined || priceMinMinor !== undefined
          ? {
              priceMinMinor: Math.min(
                currentRow.priceMinMinor ?? Number.MAX_SAFE_INTEGER,
                priceMinMinor ?? Number.MAX_SAFE_INTEGER,
              ),
            }
          : {}),
        ...(currentRow.priceMaxMinor !== undefined || priceMaxMinor !== undefined
          ? {
              priceMaxMinor: Math.max(
                currentRow.priceMaxMinor ?? 0,
                priceMaxMinor ?? 0,
              ),
            }
          : {}),
        ...(weightedAverageMinor !== undefined
          ? { priceAvgMinor: weightedAverageMinor }
          : {}),
        quantity: totalQuantity,
      });
    }

    return aggregatedRows;
  }

  private readTargetHints(
    requestMeta?: Record<string, unknown>,
  ): readonly TargetHints[] {
    const rawTargets = Array.isArray(requestMeta?.targets)
      ? requestMeta.targets
      : [];

    return rawTargets
      .map((target) => this.mapTargetHint(target))
      .filter((target): target is TargetHints => target !== null);
  }

  private mapTargetHint(value: unknown): TargetHints | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const target = value as Partial<ManagedMarketTargetDto>;

    if (
      typeof target.canonicalItemId !== 'string' ||
      typeof target.itemVariantId !== 'string' ||
      typeof target.marketHashName !== 'string'
    ) {
      return null;
    }

    const canonicalItemId = target.canonicalItemId.trim();
    const itemVariantId = target.itemVariantId.trim();
    const marketHashName = target.marketHashName.trim();

    if (
      canonicalItemId.length === 0 ||
      itemVariantId.length === 0 ||
      marketHashName.length === 0
    ) {
      return null;
    }

    return {
      canonicalItemId,
      itemVariantId,
      marketHashName: this.aliasNormalizationService.normalizeMarketHashName(
        marketHashName,
      ),
    };
  }

  private isEnvelope(value: unknown): value is BitSkinsMarketSnapshotDto {
    return (
      typeof value === 'object' &&
      value !== null &&
      'list' in value &&
      Array.isArray((value as { list?: unknown[] }).list)
    );
  }

  private normalizeLookupKey(value: string): string {
    return this.aliasNormalizationService
      .normalizeMarketHashName(value)
      .toLowerCase();
  }

  private detectStatTrak(title: string): boolean {
    return /^StatTrak/iu.test(this.aliasNormalizationService.stripStarPrefix(title));
  }

  private detectSouvenir(title: string): boolean {
    return /^Souvenir/iu.test(this.aliasNormalizationService.stripStarPrefix(title));
  }

  private deriveConfidence(
    quantity: number,
    hasAverageAnchor: boolean,
  ): number {
    const baseConfidence = Math.min(0.9, 0.45 + Math.log10(quantity + 1) / 4.5);
    const anchorBoost = hasAverageAnchor ? 0.05 : 0;

    return Number(Math.min(0.95, baseConfidence + anchorBoost).toFixed(4));
  }

  private deriveLiquidityScore(quantity: number): number {
    return Number(Math.min(1, Math.log10(quantity + 1) / 2).toFixed(4));
  }

  private buildUnresolvedWarning(
    title: string,
    resolution: {
      readonly confidence: number;
      readonly reason?: string;
      readonly warnings: readonly string[];
    },
  ): string {
    return `BitSkins catalog resolver left "${title}" unresolved at confidence ${resolution.confidence.toFixed(2)}${resolution.reason ? ` (${resolution.reason})` : ''}${resolution.warnings.length > 0 ? `: ${resolution.warnings.join('; ')}` : '.'}`;
  }

  private toMinor(value?: number): number | undefined {
    if (value === undefined || !Number.isFinite(value)) {
      return undefined;
    }

    return Math.round(value);
  }

  private buildMappingHints(
    input: ResolveBitSkinsListingInput,
  ): Record<string, unknown> {
    return {
      marketHashName: input.marketHashName,
      exterior: input.exterior ?? null,
      isStatTrak: input.isStatTrak ?? null,
      isSouvenir: input.isSouvenir ?? null,
      phaseHint: input.phaseHint ?? null,
      targetCanonicalItemId: input.targetCanonicalItemId ?? null,
      targetItemVariantId: input.targetItemVariantId ?? null,
    };
  }
}
