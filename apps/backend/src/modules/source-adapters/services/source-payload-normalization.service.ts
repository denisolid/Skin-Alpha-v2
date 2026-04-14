import { Inject, Injectable } from '@nestjs/common';

import { AppLoggerService } from '../../../infrastructure/logging/app-logger.service';
import type { NormalizeSourcePayloadJobData } from '../dto/normalize-source-payload.job.dto';
import type { NormalizedSourcePayloadDto } from '../dto/normalized-source-payload.dto';
import { RawPayloadArchiveService } from './raw-payload-archive.service';
import { BitSkinsPayloadNormalizerService } from './bitskins-payload-normalizer.service';
import { CsFloatPayloadNormalizerService } from './csfloat-payload-normalizer.service';
import { DMarketPayloadNormalizerService } from './dmarket-payload-normalizer.service';
import { ManagedMarketPayloadNormalizerService } from './managed-market-payload-normalizer.service';
import { SkinportPayloadNormalizerService } from './skinport-payload-normalizer.service';
import { SteamSnapshotPayloadNormalizerService } from './steam-snapshot-payload-normalizer.service';
import { WaxpeerPayloadNormalizerService } from './waxpeer-payload-normalizer.service';

@Injectable()
export class SourcePayloadNormalizationService {
  constructor(
    @Inject(AppLoggerService)
    private readonly logger: AppLoggerService,
    @Inject(RawPayloadArchiveService)
    private readonly rawPayloadArchiveService: RawPayloadArchiveService,
    @Inject(BitSkinsPayloadNormalizerService)
    private readonly bitSkinsPayloadNormalizerService: BitSkinsPayloadNormalizerService,
    @Inject(CsFloatPayloadNormalizerService)
    private readonly csfloatPayloadNormalizerService: CsFloatPayloadNormalizerService,
    @Inject(DMarketPayloadNormalizerService)
    private readonly dmarketPayloadNormalizerService: DMarketPayloadNormalizerService,
    @Inject(WaxpeerPayloadNormalizerService)
    private readonly waxpeerPayloadNormalizerService: WaxpeerPayloadNormalizerService,
    @Inject(ManagedMarketPayloadNormalizerService)
    private readonly managedMarketPayloadNormalizerService: ManagedMarketPayloadNormalizerService,
    @Inject(SkinportPayloadNormalizerService)
    private readonly skinportPayloadNormalizerService: SkinportPayloadNormalizerService,
    @Inject(SteamSnapshotPayloadNormalizerService)
    private readonly steamSnapshotPayloadNormalizerService: SteamSnapshotPayloadNormalizerService,
  ) {}

  async normalizeArchivedPayload(
    input: NormalizeSourcePayloadJobData,
  ): Promise<NormalizedSourcePayloadDto> {
    const archive = await this.rawPayloadArchiveService.getArchivedPayloadById(
      input.rawPayloadArchiveId,
    );
    const normalizedAt = new Date();
    this.logger.log(
      `Detected payload shape ${this.describePayloadShape(archive.payload)} for ${archive.source}:${archive.endpointName} (${archive.id}).`,
      SourcePayloadNormalizationService.name,
    );

    try {
      const previousEquivalentArchive =
        ((archive.source === 'skinport' &&
          (archive.endpointName === 'skinport-sales-history' ||
            archive.endpointName === 'skinport-items-snapshot')) ||
          (archive.source === 'dmarket' &&
            archive.endpointName === 'dmarket-market-items') ||
          (archive.source === 'waxpeer' &&
            archive.endpointName === 'waxpeer-mass-info') ||
          (archive.source === 'bitskins' &&
            archive.endpointName === 'bitskins-listings'))
          ? await this.rawPayloadArchiveService.findPreviouslyNormalizedEquivalentArchive(
              archive,
            )
          : null;

      if (previousEquivalentArchive) {
        this.logger.log(
          `Skipped normalization for unchanged ${archive.source}:${archive.endpointName} payload ${archive.id}; identical payload hash ${archive.payloadHash} was already normalized.`,
          SourcePayloadNormalizationService.name,
        );

        return this.withArchiveMetadata(
          {
            rawPayloadArchiveId: archive.id,
            source: archive.source,
            endpointName: archive.endpointName,
            observedAt: archive.observedAt,
            payloadHash: archive.payloadHash,
            equivalentMarketStateSourceArchiveId: previousEquivalentArchive.id,
            listings: [],
            marketStates: [],
            warnings: [
              `Skipped unchanged ${archive.source}:${archive.endpointName} payload because the same payload hash was already normalized.`,
            ],
          },
          archive,
          normalizedAt,
        );
      }

      if (archive.source === 'skinport') {
        return this.withArchiveMetadata(
          await this.skinportPayloadNormalizerService.normalize(archive),
          archive,
          normalizedAt,
        );
      }

      if (archive.source === 'csfloat') {
        return this.withArchiveMetadata(
          await this.csfloatPayloadNormalizerService.normalize(archive),
          archive,
          normalizedAt,
        );
      }

      if (archive.source === 'dmarket') {
        return this.withArchiveMetadata(
          await this.dmarketPayloadNormalizerService.normalize(archive),
          archive,
          normalizedAt,
        );
      }

      if (archive.source === 'waxpeer') {
        return this.withArchiveMetadata(
          await this.waxpeerPayloadNormalizerService.normalize(archive),
          archive,
          normalizedAt,
        );
      }

      if (archive.source === 'bitskins') {
        return this.withArchiveMetadata(
          await this.bitSkinsPayloadNormalizerService.normalize(archive),
          archive,
          normalizedAt,
        );
      }

      if (archive.source === 'steam-snapshot') {
        return this.withArchiveMetadata(
          this.steamSnapshotPayloadNormalizerService.normalize(archive),
          archive,
          normalizedAt,
        );
      }

      if (
        archive.source === 'youpin' ||
        archive.source === 'c5game' ||
        archive.source === 'csmoney'
      ) {
        return this.withArchiveMetadata(
          await this.managedMarketPayloadNormalizerService.normalize(archive),
          archive,
          normalizedAt,
        );
      }
    } catch (error) {
      this.logger.error(
        `Normalization failed for ${archive.source}:${archive.endpointName} (${archive.id}): ${error instanceof Error ? error.message : 'Unknown normalization error'}`,
        error instanceof Error ? error.stack : undefined,
        SourcePayloadNormalizationService.name,
      );
      throw error;
    }

    return this.withArchiveMetadata(
      {
        rawPayloadArchiveId: archive.id,
        source: archive.source,
        endpointName: archive.endpointName,
        observedAt: archive.observedAt,
        payloadHash: archive.payloadHash,
        listings: [],
        marketStates: [],
        warnings: [
          `No source-specific normalizer is registered for ${archive.source}:${archive.endpointName}.`,
        ],
      },
      archive,
      normalizedAt,
    );
  }

  private withArchiveMetadata(
    payload: NormalizedSourcePayloadDto,
    archive: Awaited<ReturnType<RawPayloadArchiveService['getArchivedPayloadById']>>,
    normalizedAt: Date,
  ): NormalizedSourcePayloadDto {
    return {
      ...payload,
      ...(archive.sourceObservedAt
        ? { sourceObservedAt: archive.sourceObservedAt }
        : {}),
      ...(archive.fetchJobId ? { fetchJobId: archive.fetchJobId } : {}),
      ...(archive.jobRunId ? { jobRunId: archive.jobRunId } : {}),
      fetchedAt: archive.fetchedAt,
      archivedAt: archive.archivedAt,
      normalizedAt,
    };
  }

  private describePayloadShape(value: unknown): string {
    if (Array.isArray(value)) {
      return `array(${value.length})`;
    }

    if (value && typeof value === 'object') {
      return `object(${Object.keys(value as Record<string, unknown>).length}-keys)`;
    }

    return typeof value;
  }
}
