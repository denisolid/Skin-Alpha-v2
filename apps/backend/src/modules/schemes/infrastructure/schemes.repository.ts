import { Prisma } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  CreateSchemeInput,
  SchemesRepository,
  UpdateSchemeInput,
} from '../domain/schemes.repository';
import type { SchemeRecord } from '../domain/scheme.model';

const schemeSelect = Prisma.validator<Prisma.SchemeSelect>()({
  id: true,
  userId: true,
  name: true,
  description: true,
  status: true,
  revision: true,
  originPresetKey: true,
  feedEnabled: true,
  liveEnabled: true,
  alertsEnabled: true,
  priority: true,
  configHash: true,
  scopeJson: true,
  selectionJson: true,
  thresholdsJson: true,
  validationJson: true,
  viewJson: true,
  alertJson: true,
  liveJson: true,
  activatedAt: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
});

type PersistedScheme = Prisma.SchemeGetPayload<{
  select: typeof schemeSelect;
}>;

@Injectable()
export class SchemesRepositoryAdapter implements SchemesRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
  ) {}

  async findSchemesByUser(userId: string): Promise<readonly SchemeRecord[]> {
    const schemes = await this.prismaService.scheme.findMany({
      where: {
        userId,
      },
      select: schemeSelect,
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }, { name: 'asc' }],
    });

    return schemes.map((scheme) => this.mapRecord(scheme));
  }

  async findSchemeById(
    userId: string,
    schemeId: string,
  ): Promise<SchemeRecord | null> {
    const scheme = await this.prismaService.scheme.findFirst({
      where: {
        id: schemeId,
        userId,
      },
      select: schemeSelect,
    });

    return scheme ? this.mapRecord(scheme) : null;
  }

  async createScheme(input: CreateSchemeInput): Promise<SchemeRecord> {
    const scheme = await this.prismaService.scheme.create({
      data: {
        userId: input.userId,
        name: input.name,
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.originPresetKey !== undefined
          ? { originPresetKey: input.originPresetKey }
          : {}),
        feedEnabled: input.feedEnabled,
        liveEnabled: input.liveEnabled,
        alertsEnabled: input.alertsEnabled,
        priority: input.priority,
        configHash: input.configHash,
        scopeJson: input.scopeJson,
        selectionJson: input.selectionJson,
        thresholdsJson: input.thresholdsJson,
        validationJson: input.validationJson,
        viewJson: input.viewJson,
        ...(input.alertJson !== undefined ? { alertJson: input.alertJson } : {}),
        ...(input.liveJson !== undefined ? { liveJson: input.liveJson } : {}),
      },
      select: schemeSelect,
    });

    return this.mapRecord(scheme);
  }

  async updateScheme(input: UpdateSchemeInput): Promise<SchemeRecord | null> {
    const existing = await this.prismaService.scheme.findFirst({
      where: {
        id: input.schemeId,
        userId: input.userId,
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      return null;
    }

    const scheme = await this.prismaService.scheme.update({
      where: {
        id: input.schemeId,
      },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.feedEnabled !== undefined
          ? { feedEnabled: input.feedEnabled }
          : {}),
        ...(input.liveEnabled !== undefined
          ? { liveEnabled: input.liveEnabled }
          : {}),
        ...(input.alertsEnabled !== undefined
          ? { alertsEnabled: input.alertsEnabled }
          : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.configHash !== undefined ? { configHash: input.configHash } : {}),
        ...(input.scopeJson !== undefined ? { scopeJson: input.scopeJson } : {}),
        ...(input.selectionJson !== undefined
          ? { selectionJson: input.selectionJson }
          : {}),
        ...(input.thresholdsJson !== undefined
          ? { thresholdsJson: input.thresholdsJson }
          : {}),
        ...(input.validationJson !== undefined
          ? { validationJson: input.validationJson }
          : {}),
        ...(input.viewJson !== undefined ? { viewJson: input.viewJson } : {}),
        ...(input.alertJson !== undefined ? { alertJson: input.alertJson } : {}),
        ...(input.liveJson !== undefined ? { liveJson: input.liveJson } : {}),
        revision: {
          increment: 1,
        },
      },
      select: schemeSelect,
    });

    return this.mapRecord(scheme);
  }

  async updateSchemeStatus(input: {
    readonly userId: string;
    readonly schemeId: string;
    readonly status: PersistedScheme['status'];
    readonly feedEnabled?: boolean;
    readonly liveEnabled?: boolean;
    readonly alertsEnabled?: boolean;
    readonly archivedAt?: Date | null;
    readonly activatedAt?: Date | null;
  }): Promise<SchemeRecord | null> {
    const existing = await this.prismaService.scheme.findFirst({
      where: {
        id: input.schemeId,
        userId: input.userId,
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      return null;
    }

    const scheme = await this.prismaService.scheme.update({
      where: {
        id: input.schemeId,
      },
      data: {
        status: input.status,
        ...(input.feedEnabled !== undefined
          ? { feedEnabled: input.feedEnabled }
          : {}),
        ...(input.liveEnabled !== undefined
          ? { liveEnabled: input.liveEnabled }
          : {}),
        ...(input.alertsEnabled !== undefined
          ? { alertsEnabled: input.alertsEnabled }
          : {}),
        ...(input.archivedAt !== undefined ? { archivedAt: input.archivedAt } : {}),
        ...(input.activatedAt !== undefined
          ? { activatedAt: input.activatedAt }
          : {}),
        revision: {
          increment: 1,
        },
      },
      select: schemeSelect,
    });

    return this.mapRecord(scheme);
  }

  private mapRecord(record: PersistedScheme): SchemeRecord {
    return {
      id: record.id,
      userId: record.userId,
      name: record.name,
      description: record.description,
      status: record.status,
      revision: record.revision,
      originPresetKey: record.originPresetKey,
      feedEnabled: record.feedEnabled,
      liveEnabled: record.liveEnabled,
      alertsEnabled: record.alertsEnabled,
      priority: record.priority,
      configHash: record.configHash,
      scopeJson: record.scopeJson,
      selectionJson: record.selectionJson,
      thresholdsJson: record.thresholdsJson,
      validationJson: record.validationJson,
      viewJson: record.viewJson,
      alertJson: record.alertJson,
      liveJson: record.liveJson,
      activatedAt: record.activatedAt,
      archivedAt: record.archivedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
