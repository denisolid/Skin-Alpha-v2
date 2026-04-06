import { Inject, Injectable } from '@nestjs/common';

import { AppLoggerService } from '../../../infrastructure/logging/app-logger.service';
import type { NormalizeSourcePayloadJobData } from '../dto/normalize-source-payload.job.dto';
import type { NormalizedSourcePayloadDto } from '../dto/normalized-source-payload.dto';
import { RawPayloadArchiveService } from './raw-payload-archive.service';
import { CsFloatPayloadNormalizerService } from './csfloat-payload-normalizer.service';
import { ManagedMarketPayloadNormalizerService } from './managed-market-payload-normalizer.service';
import { SkinportPayloadNormalizerService } from './skinport-payload-normalizer.service';

@Injectable()
export class SourcePayloadNormalizationService {
  constructor(
    @Inject(AppLoggerService)
    private readonly logger: AppLoggerService,
    @Inject(RawPayloadArchiveService)
    private readonly rawPayloadArchiveService: RawPayloadArchiveService,
    @Inject(CsFloatPayloadNormalizerService)
    private readonly csfloatPayloadNormalizerService: CsFloatPayloadNormalizerService,
    @Inject(ManagedMarketPayloadNormalizerService)
    private readonly managedMarketPayloadNormalizerService: ManagedMarketPayloadNormalizerService,
    @Inject(SkinportPayloadNormalizerService)
    private readonly skinportPayloadNormalizerService: SkinportPayloadNormalizerService,
  ) {}

  async normalizeArchivedPayload(
    input: NormalizeSourcePayloadJobData,
  ): Promise<NormalizedSourcePayloadDto> {
    const archive = await this.rawPayloadArchiveService.getArchivedPayloadById(
      input.rawPayloadArchiveId,
    );
    this.logger.log(
      `Detected payload shape ${this.describePayloadShape(archive.payload)} for ${archive.source}:${archive.endpointName} (${archive.id}).`,
      SourcePayloadNormalizationService.name,
    );

    try {
      if (archive.source === 'skinport') {
        return await this.skinportPayloadNormalizerService.normalize(archive);
      }

      if (archive.source === 'csfloat') {
        return await this.csfloatPayloadNormalizerService.normalize(archive);
      }

      if (
        archive.source === 'youpin' ||
        archive.source === 'bitskins' ||
        archive.source === 'c5game' ||
        archive.source === 'csmoney'
      ) {
        return await this.managedMarketPayloadNormalizerService.normalize(
          archive,
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

    return {
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
