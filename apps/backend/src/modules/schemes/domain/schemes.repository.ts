import type { Prisma, SchemeStatus } from '@prisma/client';

import type { SchemeRecord } from './scheme.model';

export const SCHEMES_REPOSITORY = Symbol('SCHEMES_REPOSITORY');

export interface CreateSchemeInput {
  readonly userId: string;
  readonly name: string;
  readonly description?: string | null;
  readonly originPresetKey?: string | null;
  readonly feedEnabled: boolean;
  readonly liveEnabled: boolean;
  readonly alertsEnabled: boolean;
  readonly priority: number;
  readonly configHash: string;
  readonly scopeJson: Prisma.InputJsonValue;
  readonly selectionJson: Prisma.InputJsonValue;
  readonly thresholdsJson: Prisma.InputJsonValue;
  readonly validationJson: Prisma.InputJsonValue;
  readonly viewJson: Prisma.InputJsonValue;
  readonly alertJson?: Prisma.InputJsonValue;
  readonly liveJson?: Prisma.InputJsonValue;
}

export interface UpdateSchemeInput {
  readonly userId: string;
  readonly schemeId: string;
  readonly name?: string;
  readonly description?: string | null;
  readonly feedEnabled?: boolean;
  readonly liveEnabled?: boolean;
  readonly alertsEnabled?: boolean;
  readonly priority?: number;
  readonly configHash?: string;
  readonly scopeJson?: Prisma.InputJsonValue;
  readonly selectionJson?: Prisma.InputJsonValue;
  readonly thresholdsJson?: Prisma.InputJsonValue;
  readonly validationJson?: Prisma.InputJsonValue;
  readonly viewJson?: Prisma.InputJsonValue;
  readonly alertJson?: Prisma.InputJsonValue;
  readonly liveJson?: Prisma.InputJsonValue;
}

export interface SchemesRepository {
  findSchemesByUser(userId: string): Promise<readonly SchemeRecord[]>;
  findSchemeById(userId: string, schemeId: string): Promise<SchemeRecord | null>;
  createScheme(input: CreateSchemeInput): Promise<SchemeRecord>;
  updateScheme(input: UpdateSchemeInput): Promise<SchemeRecord | null>;
  updateSchemeStatus(input: {
    readonly userId: string;
    readonly schemeId: string;
    readonly status: SchemeStatus;
    readonly feedEnabled?: boolean;
    readonly liveEnabled?: boolean;
    readonly alertsEnabled?: boolean;
    readonly archivedAt?: Date | null;
    readonly activatedAt?: Date | null;
  }): Promise<SchemeRecord | null>;
}
