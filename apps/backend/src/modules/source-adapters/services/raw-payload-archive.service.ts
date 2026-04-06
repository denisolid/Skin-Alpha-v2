import { ArchiveEntityType } from '@prisma/client';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { AppLoggerService } from '../../../infrastructure/logging/app-logger.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { ArchivedRawPayloadDto } from '../dto/archived-raw-payload.dto';
import type { SourceRawPayloadDto } from '../dto/source-raw-payload.dto';
import { canonicalizeJsonPayload } from '../infrastructure/utils/json-payload.util';
import { SourceRecordService } from './source-record.service';

@Injectable()
export class RawPayloadArchiveService {
  constructor(
    @Inject(AppLoggerService)
    private readonly logger: AppLoggerService,
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(SourceRecordService)
    private readonly sourceRecordService: SourceRecordService,
  ) {}

  async archive(input: SourceRawPayloadDto): Promise<ArchivedRawPayloadDto> {
    const source = await this.sourceRecordService.resolveByKey(input.source);
    const canonicalPayload = canonicalizeJsonPayload(input.payload);
    const endpointName = this.normalizeRequiredString(
      input.endpointName,
      'endpointName',
    );
    const externalId = this.normalizeOptionalString(input.externalId);
    const sourceListingId = this.normalizeOptionalString(input.sourceListingId);
    const jobRunId = this.normalizeOptionalString(input.jobRunId);
    const contentType = this.normalizeOptionalString(input.contentType);
    const createdArchive = await this.prismaService.rawPayloadArchive.create({
      data: {
        sourceId: source.id,
        endpointName,
        observedAt: input.observedAt,
        entityType: input.entityType ?? ArchiveEntityType.SOURCE_SYNC,
        entityId: this.buildEntityId(
          endpointName,
          externalId,
          canonicalPayload.hash,
        ),
        payload: canonicalPayload.value,
        payloadHash: canonicalPayload.hash,
        fetchedAt: new Date(),
        ...(sourceListingId ? { sourceListingId } : {}),
        ...(jobRunId ? { jobRunId } : {}),
        ...(externalId ? { externalId } : {}),
        ...(contentType ? { contentType } : {}),
        ...(input.httpStatus !== undefined
          ? { httpStatus: input.httpStatus }
          : {}),
      },
      include: {
        source: true,
      },
    });
    this.logger.log(
      `Archived raw payload ${createdArchive.id} for ${createdArchive.source.code}:${createdArchive.endpointName} (${this.describePayloadShape(createdArchive.payload)}).`,
      RawPayloadArchiveService.name,
    );

    return {
      id: createdArchive.id,
      sourceId: createdArchive.sourceId,
      source: createdArchive.source.code as typeof input.source,
      endpointName: createdArchive.endpointName,
      ...(createdArchive.externalId
        ? { externalId: createdArchive.externalId }
        : {}),
      observedAt: createdArchive.observedAt,
      entityType: createdArchive.entityType,
      entityId: createdArchive.entityId,
      payload: createdArchive.payload,
      payloadHash: createdArchive.payloadHash,
      ...(createdArchive.contentType
        ? { contentType: createdArchive.contentType }
        : {}),
      ...(createdArchive.httpStatus !== null
        ? { httpStatus: createdArchive.httpStatus }
        : {}),
      fetchedAt: createdArchive.fetchedAt,
    };
  }

  async getArchivedPayloadById(id: string): Promise<ArchivedRawPayloadDto> {
    const archive = await this.prismaService.rawPayloadArchive.findUnique({
      where: {
        id,
      },
      include: {
        source: true,
      },
    });

    if (!archive) {
      throw new NotFoundException(`Raw payload archive "${id}" was not found.`);
    }

    return {
      id: archive.id,
      sourceId: archive.sourceId,
      source: archive.source.code as ArchivedRawPayloadDto['source'],
      endpointName: archive.endpointName,
      ...(archive.externalId ? { externalId: archive.externalId } : {}),
      observedAt: archive.observedAt,
      entityType: archive.entityType,
      entityId: archive.entityId,
      payload: archive.payload,
      payloadHash: archive.payloadHash,
      ...(archive.contentType ? { contentType: archive.contentType } : {}),
      ...(archive.httpStatus !== null
        ? { httpStatus: archive.httpStatus }
        : {}),
      fetchedAt: archive.fetchedAt,
    };
  }

  private buildEntityId(
    endpointName: string,
    externalId: string | undefined,
    payloadHash: string,
  ): string {
    return externalId ?? `${endpointName}:${payloadHash}`;
  }

  private normalizeOptionalString(
    value: string | undefined,
  ): string | undefined {
    const normalizedValue = value?.trim();

    return normalizedValue || undefined;
  }

  private normalizeRequiredString(value: string, fieldName: string): string {
    const normalizedValue = value.trim();

    if (normalizedValue.length === 0) {
      throw new Error(`"${fieldName}" must not be empty.`);
    }

    return normalizedValue;
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
