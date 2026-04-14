import { ArchiveEntityType, type Prisma } from '@prisma/client';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { AppLoggerService } from '../../../infrastructure/logging/app-logger.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { ArchivedRawPayloadDto } from '../dto/archived-raw-payload.dto';
import type { SourceRawPayloadDto } from '../dto/source-raw-payload.dto';
import { canonicalizeJsonPayload } from '../infrastructure/utils/json-payload.util';
import { SourceFetchJobService } from './source-fetch-job.service';
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
    @Inject(SourceFetchJobService)
    private readonly sourceFetchJobService: SourceFetchJobService,
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
    const fetchJobId =
      this.normalizeOptionalString(input.fetchJobId) ??
      (jobRunId ? await this.resolveFetchJobIdByJobRunId(jobRunId) : undefined);
    const contentType = this.normalizeOptionalString(input.contentType);
    const schemaFingerprint = this.normalizeOptionalString(
      input.schemaFingerprint,
    );
    const requestFingerprint = this.normalizeOptionalString(
      input.requestFingerprint,
    );
    const requestMeta = this.serializeJsonRecord(input.requestMeta);
    const responseMeta = this.serializeJsonRecord(input.responseMeta);
    const cursor = this.serializeJsonRecord(input.cursor);
    const createdArchive = await this.prismaService.rawPayloadArchive.create({
      data: {
        sourceId: source.id,
        endpointName,
        observedAt: input.observedAt,
        ...(input.sourceObservedAt ? { sourceObservedAt: input.sourceObservedAt } : {}),
        entityType: input.entityType ?? ArchiveEntityType.SOURCE_SYNC,
        entityId: this.buildEntityId(
          endpointName,
          externalId,
          canonicalPayload.hash,
        ),
        payload: canonicalPayload.value,
        payloadHash: canonicalPayload.hash,
        fetchedAt: new Date(),
        archivedAt: new Date(),
        ...(sourceListingId ? { sourceListingId } : {}),
        ...(jobRunId ? { jobRunId } : {}),
        ...(fetchJobId ? { fetchJobId } : {}),
        ...(externalId ? { externalId } : {}),
        ...(schemaFingerprint ? { schemaFingerprint } : {}),
        ...(requestFingerprint ? { requestFingerprint } : {}),
        ...(requestMeta ? { requestMeta } : {}),
        ...(responseMeta ? { responseMeta } : {}),
        ...(cursor ? { cursor } : {}),
        ...(input.windowStart ? { windowStart: input.windowStart } : {}),
        ...(input.windowEnd ? { windowEnd: input.windowEnd } : {}),
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
    await this.sourceFetchJobService.linkRawPayloadArchive(
      createdArchive.id,
      createdArchive.fetchJobId ?? undefined,
    );

    return {
      id: createdArchive.id,
      sourceId: createdArchive.sourceId,
      source: createdArchive.source.code as typeof input.source,
      ...(createdArchive.fetchJobId
        ? { fetchJobId: createdArchive.fetchJobId }
        : {}),
      ...(createdArchive.jobRunId ? { jobRunId: createdArchive.jobRunId } : {}),
      endpointName: createdArchive.endpointName,
      ...(createdArchive.externalId
        ? { externalId: createdArchive.externalId }
        : {}),
      observedAt: createdArchive.observedAt,
      ...(createdArchive.sourceObservedAt
        ? { sourceObservedAt: createdArchive.sourceObservedAt }
        : {}),
      entityType: createdArchive.entityType,
      entityId: createdArchive.entityId,
      payload: createdArchive.payload,
      payloadHash: createdArchive.payloadHash,
      ...(createdArchive.schemaFingerprint
        ? { schemaFingerprint: createdArchive.schemaFingerprint }
        : {}),
      ...(createdArchive.requestFingerprint
        ? { requestFingerprint: createdArchive.requestFingerprint }
        : {}),
      ...(this.deserializeJsonRecord(createdArchive.requestMeta)
        ? { requestMeta: this.deserializeJsonRecord(createdArchive.requestMeta)! }
        : {}),
      ...(this.deserializeJsonRecord(createdArchive.responseMeta)
        ? {
            responseMeta: this.deserializeJsonRecord(
              createdArchive.responseMeta,
            )!,
          }
        : {}),
      ...(this.deserializeJsonRecord(createdArchive.cursor)
        ? { cursor: this.deserializeJsonRecord(createdArchive.cursor)! }
        : {}),
      ...(createdArchive.windowStart
        ? { windowStart: createdArchive.windowStart }
        : {}),
      ...(createdArchive.windowEnd ? { windowEnd: createdArchive.windowEnd } : {}),
      ...(createdArchive.contentType
        ? { contentType: createdArchive.contentType }
        : {}),
      ...(createdArchive.httpStatus !== null
        ? { httpStatus: createdArchive.httpStatus }
        : {}),
      fetchedAt: createdArchive.fetchedAt,
      archivedAt: createdArchive.archivedAt,
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
      ...(archive.fetchJobId ? { fetchJobId: archive.fetchJobId } : {}),
      ...(archive.jobRunId ? { jobRunId: archive.jobRunId } : {}),
      endpointName: archive.endpointName,
      ...(archive.externalId ? { externalId: archive.externalId } : {}),
      observedAt: archive.observedAt,
      ...(archive.sourceObservedAt
        ? { sourceObservedAt: archive.sourceObservedAt }
        : {}),
      entityType: archive.entityType,
      entityId: archive.entityId,
      payload: archive.payload,
      payloadHash: archive.payloadHash,
      ...(archive.schemaFingerprint
        ? { schemaFingerprint: archive.schemaFingerprint }
        : {}),
      ...(archive.requestFingerprint
        ? { requestFingerprint: archive.requestFingerprint }
        : {}),
      ...(this.deserializeJsonRecord(archive.requestMeta)
        ? { requestMeta: this.deserializeJsonRecord(archive.requestMeta)! }
        : {}),
      ...(this.deserializeJsonRecord(archive.responseMeta)
        ? { responseMeta: this.deserializeJsonRecord(archive.responseMeta)! }
        : {}),
      ...(this.deserializeJsonRecord(archive.cursor)
        ? { cursor: this.deserializeJsonRecord(archive.cursor)! }
        : {}),
      ...(archive.windowStart ? { windowStart: archive.windowStart } : {}),
      ...(archive.windowEnd ? { windowEnd: archive.windowEnd } : {}),
      ...(archive.contentType ? { contentType: archive.contentType } : {}),
      ...(archive.httpStatus !== null
        ? { httpStatus: archive.httpStatus }
        : {}),
      fetchedAt: archive.fetchedAt,
      archivedAt: archive.archivedAt,
    };
  }

  async findPreviouslyNormalizedEquivalentArchive(
    archive: Pick<
      ArchivedRawPayloadDto,
      | 'id'
      | 'sourceId'
      | 'endpointName'
      | 'payloadHash'
      | 'requestFingerprint'
      | 'archivedAt'
    >,
  ): Promise<
    | {
        readonly id: string;
      }
    | null
  > {
    const previousArchive = await this.prismaService.rawPayloadArchive.findFirst({
      where: {
        sourceId: archive.sourceId,
        endpointName: archive.endpointName,
        payloadHash: archive.payloadHash,
        ...(archive.requestFingerprint
          ? {
              requestFingerprint: archive.requestFingerprint,
            }
          : {}),
        id: {
          not: archive.id,
        },
        archivedAt: {
          lt: archive.archivedAt,
        },
      },
      orderBy: {
        archivedAt: 'desc',
      },
      select: {
        id: true,
      },
    });

    if (!previousArchive) {
      return null;
    }

    const [factCount, provenanceCount, pendingMappingCount] = await Promise.all([
      this.prismaService.sourceMarketFact.count({
        where: {
          rawPayloadArchiveId: previousArchive.id,
        },
      }),
      this.prismaService.sourceEntityProvenance.count({
        where: {
          rawPayloadArchiveId: previousArchive.id,
        },
      }),
      this.prismaService.pendingSourceMapping.count({
        where: {
          rawPayloadArchiveId: previousArchive.id,
        },
      }),
    ]);

    return factCount > 0 || provenanceCount > 0 || pendingMappingCount > 0
      ? previousArchive
      : null;
  }

  async hasPreviouslyNormalizedEquivalentArchive(
    archive: Pick<
      ArchivedRawPayloadDto,
      | 'id'
      | 'sourceId'
      | 'endpointName'
      | 'payloadHash'
      | 'requestFingerprint'
      | 'archivedAt'
    >,
  ): Promise<boolean> {
    return Boolean(
      await this.findPreviouslyNormalizedEquivalentArchive(archive),
    );
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

  private serializeJsonRecord(
    value: Record<string, unknown> | undefined,
  ): Prisma.InputJsonValue | undefined {
    if (!value) {
      return undefined;
    }

    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private deserializeJsonRecord(
    value: unknown,
  ): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    return value as Record<string, unknown>;
  }

  private async resolveFetchJobIdByJobRunId(
    jobRunId: string,
  ): Promise<string | undefined> {
    const jobRun = await this.prismaService.jobRun.findUnique({
      where: {
        id: jobRunId,
      },
      select: {
        fetchJobId: true,
      },
    });

    return jobRun?.fetchJobId ?? undefined;
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
