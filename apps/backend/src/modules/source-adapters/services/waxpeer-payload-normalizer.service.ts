import { Inject, Injectable, Optional } from '@nestjs/common';

import { CatalogAliasNormalizationService } from '../../catalog/services/catalog-alias-normalization.service';
import { WAXPEER_MASS_INFO_ENDPOINT_NAME } from '../domain/waxpeer.constants';
import type { ArchivedRawPayloadDto } from '../dto/archived-raw-payload.dto';
import type {
  WaxpeerMassInfoListingDto,
  WaxpeerMassInfoResponseDto,
} from '../dto/waxpeer-market-item.dto';
import type { NormalizedMarketListingDto } from '../dto/normalized-market-listing.dto';
import type { NormalizedSourcePayloadDto } from '../dto/normalized-source-payload.dto';
import {
  WaxpeerCatalogLinkerService,
  type ResolveWaxpeerListingInput,
} from './waxpeer-catalog-linker.service';

interface FlattenedWaxpeerListing {
  readonly requestedName: string;
  readonly listing: WaxpeerMassInfoListingDto;
  readonly info?: Record<string, unknown>;
}

@Injectable()
export class WaxpeerPayloadNormalizerService {
  constructor(
    @Inject(WaxpeerCatalogLinkerService)
    private readonly waxpeerCatalogLinkerService: WaxpeerCatalogLinkerService,
    @Optional()
    @Inject(CatalogAliasNormalizationService)
    private readonly aliasNormalizationService: CatalogAliasNormalizationService = new CatalogAliasNormalizationService(),
  ) {}

  async normalize(
    archive: ArchivedRawPayloadDto,
  ): Promise<NormalizedSourcePayloadDto> {
    if (archive.endpointName !== WAXPEER_MASS_INFO_ENDPOINT_NAME) {
      return {
        rawPayloadArchiveId: archive.id,
        source: archive.source,
        endpointName: archive.endpointName,
        observedAt: archive.observedAt,
        payloadHash: archive.payloadHash,
        listings: [],
        marketStates: [],
        warnings: [`Unsupported Waxpeer endpoint ${archive.endpointName}.`],
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
        warnings: ['Invalid Waxpeer mass-info payload.'],
      };
    }

    const flattenedListings = this.flattenListings(payload);
    const runContext = this.waxpeerCatalogLinkerService.createRunContext();
    const resolutionInputs = flattenedListings.map(({ requestedName, listing }) =>
      this.buildResolutionInput(requestedName, listing),
    );
    const resolutions =
      await this.waxpeerCatalogLinkerService.resolveOrCreateMany(
        resolutionInputs,
        runContext,
      );
    const normalizedListings: NormalizedMarketListingDto[] = [];
    const mappingSignals: Array<
      NonNullable<NormalizedSourcePayloadDto['mappingSignals']>[number]
    > = [];
    const warnings: string[] = [];

    flattenedListings.forEach((entry, index) => {
      const resolution = resolutions[index];
      const resolutionInput = resolutionInputs[index];
      const title = this.aliasNormalizationService.normalizeMarketHashName(
        entry.listing.name?.trim() || entry.requestedName.trim(),
      );
      const externalListingId = entry.listing.item_id?.trim();
      const sourceItemId =
        entry.listing.item_id?.trim() ??
        entry.listing.classid?.trim() ??
        externalListingId;

      if (!resolution || !resolutionInput || !title || !externalListingId || !sourceItemId) {
        return;
      }

      if (
        resolution.status !== 'resolved' ||
        !resolution.canonicalItemId ||
        !resolution.itemVariantId
      ) {
        warnings.push(this.buildUnresolvedWarning(title, resolution));
        mappingSignals.push({
          kind: 'listing',
          sourceItemId,
          title,
          observedAt: archive.observedAt,
          resolutionNote: this.buildUnresolvedWarning(title, resolution),
          variantHints: this.buildMappingHints(resolutionInput),
          metadata: {
            resolutionReason: resolution.reason ?? null,
            warnings: [...resolution.warnings],
          },
        });
        return;
      }

      const priceMinor = this.toMinorAmount(entry.listing.price);

      if (priceMinor === undefined || priceMinor <= 0) {
        warnings.push(`Waxpeer listing "${title}" is missing a usable USD price.`);
        return;
      }

      normalizedListings.push({
        source: archive.source,
        externalListingId,
        sourceItemId,
        canonicalItemId: resolution.canonicalItemId,
        itemVariantId: resolution.itemVariantId,
        title,
        observedAt: archive.observedAt,
        currency: 'USD',
        priceMinor,
        quantityAvailable: 1,
        ...(resolutionInput.exterior ? { condition: resolutionInput.exterior } : {}),
        ...(resolutionInput.phaseHint ? { phase: resolutionInput.phaseHint } : {}),
        ...(entry.listing.float !== undefined
          ? { wearFloat: entry.listing.float }
          : {}),
        isStatTrak: resolutionInput.isStatTrak ?? false,
        isSouvenir: resolutionInput.isSouvenir ?? false,
        metadata: {
          sellerWaxpeerId: entry.listing.by ?? null,
          classId: entry.listing.classid ?? null,
          image: entry.listing.image ?? null,
          inspectLink: entry.listing.inspect ?? null,
          requestedName: entry.requestedName,
          steamPriceMinor: this.toMinorAmount(entry.listing.steam_price) ?? null,
          paintIndex: entry.listing.paint_index ?? null,
          type: entry.listing.type ?? null,
          info: entry.info ?? null,
        },
      });
    });

    return {
      rawPayloadArchiveId: archive.id,
      source: archive.source,
      endpointName: archive.endpointName,
      observedAt: archive.observedAt,
      payloadHash: archive.payloadHash,
      listings: normalizedListings,
      marketStates: [],
      ...(mappingSignals.length > 0 ? { mappingSignals } : {}),
      warnings,
    };
  }

  private flattenListings(
    payload: WaxpeerMassInfoResponseDto,
  ): readonly FlattenedWaxpeerListing[] {
    const flattened: FlattenedWaxpeerListing[] = [];

    for (const [requestedName, bucket] of Object.entries(payload.data)) {
      for (const listing of bucket.listings) {
        flattened.push({
          requestedName,
          listing,
          ...(bucket.info ? { info: bucket.info } : {}),
        });
      }
    }

    return flattened;
  }

  private buildResolutionInput(
    requestedName: string,
    listing: WaxpeerMassInfoListingDto,
  ): ResolveWaxpeerListingInput {
    const marketHashName = this.aliasNormalizationService.normalizeMarketHashName(
      listing.name?.trim() || requestedName.trim(),
    );
    const exterior =
      this.aliasNormalizationService.extractExteriorFromTitle(marketHashName);
    const phaseHint = this.resolvePhaseHint([
      listing.phase,
      listing.name,
      requestedName,
    ]);

    return {
      marketHashName,
      ...(exterior ? { exterior } : {}),
      isStatTrak: this.detectStatTrak(marketHashName),
      isSouvenir: this.detectSouvenir(marketHashName),
      ...(listing.paint_index !== undefined
        ? { paintIndex: listing.paint_index }
        : {}),
      ...(phaseHint ? { phaseHint } : {}),
    };
  }

  private isEnvelope(value: unknown): value is WaxpeerMassInfoResponseDto {
    return (
      typeof value === 'object' &&
      value !== null &&
      'data' in value &&
      typeof (value as { data?: unknown }).data === 'object' &&
      (value as { data?: unknown }).data !== null
    );
  }

  private extractExteriorFromTitle(title: string): string | undefined {
    return this.aliasNormalizationService.extractExteriorFromTitle(title);
  }

  private normalizeExterior(value?: string): string | undefined {
    return this.aliasNormalizationService.normalizeExterior(value);
  }

  private resolvePhaseHint(
    values: readonly (string | undefined | null)[],
  ): string | undefined {
    for (const value of values) {
      const phaseHint =
        this.aliasNormalizationService.normalizePhaseHint(value);

      if (phaseHint) {
        return phaseHint;
      }
    }

    return undefined;
  }

  private detectStatTrak(title: string): boolean {
    return /^StatTrak/iu.test(this.aliasNormalizationService.stripStarPrefix(title));
  }

  private detectSouvenir(title: string): boolean {
    return /^Souvenir/iu.test(this.aliasNormalizationService.stripStarPrefix(title));
  }

  private toMinorAmount(value?: number): number | undefined {
    if (value === undefined || !Number.isFinite(value)) {
      return undefined;
    }

    return Math.round(value / 10);
  }

  private buildUnresolvedWarning(
    title: string,
    resolution: {
      readonly confidence: number;
      readonly reason?: string;
      readonly warnings: readonly string[];
    },
  ): string {
    return `Waxpeer catalog resolver left "${title}" unresolved at confidence ${resolution.confidence.toFixed(2)}${resolution.reason ? ` (${resolution.reason})` : ''}${resolution.warnings.length > 0 ? `: ${resolution.warnings.join('; ')}` : '.'}`;
  }

  private buildMappingHints(
    input: ResolveWaxpeerListingInput,
  ): Record<string, unknown> {
    return {
      marketHashName: input.marketHashName,
      exterior: input.exterior ?? null,
      isStatTrak: input.isStatTrak ?? null,
      isSouvenir: input.isSouvenir ?? null,
      paintIndex: input.paintIndex ?? null,
      phaseHint: input.phaseHint ?? null,
    };
  }
}
