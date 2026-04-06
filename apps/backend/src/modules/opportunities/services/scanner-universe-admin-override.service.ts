import { Inject, Injectable } from '@nestjs/common';

import { RedisService } from '../../../infrastructure/redis/redis.service';
import type {
  ScannerUniverseManualOverrideDto,
  ScannerUniverseOverrideMutationDto,
} from '../dto/scanner-universe.dto';

interface StoredHotUniverseOverrideRecord {
  readonly itemVariantId: string;
  readonly createdAt: string;
  readonly createdByUserId: string;
  readonly note?: string;
  readonly expiresAt?: string;
}

interface SetHotUniverseOverrideInput {
  readonly itemVariantId: string;
  readonly createdByUserId: string;
  readonly note?: string;
  readonly ttlHours?: number;
}

const HOT_UNIVERSE_OVERRIDES_KEY = 'scanner-universe:hot-overrides';

@Injectable()
export class ScannerUniverseAdminOverrideService {
  constructor(
    @Inject(RedisService)
    private readonly redisService: RedisService,
  ) {}

  async getHotOverride(
    itemVariantId: string,
  ): Promise<ScannerUniverseManualOverrideDto | null> {
    const rawValue = await this.redisService
      .getClient()
      .hget(HOT_UNIVERSE_OVERRIDES_KEY, itemVariantId);

    if (!rawValue) {
      return null;
    }

    const record = this.parseStoredRecord(rawValue);

    if (!record || this.isExpired(record)) {
      await this.clearHotOverride(itemVariantId);

      return null;
    }

    return this.toOverrideDto(record);
  }

  async listHotOverrides(): Promise<
    ReadonlyMap<string, ScannerUniverseManualOverrideDto>
  > {
    const entries = await this.redisService
      .getClient()
      .hgetall(HOT_UNIVERSE_OVERRIDES_KEY);
    const overrides = new Map<string, ScannerUniverseManualOverrideDto>();
    const expiredItemVariantIds: string[] = [];

    for (const [itemVariantId, rawValue] of Object.entries(entries)) {
      const record = this.parseStoredRecord(rawValue);

      if (!record || this.isExpired(record)) {
        expiredItemVariantIds.push(itemVariantId);
        continue;
      }

      overrides.set(itemVariantId, this.toOverrideDto(record));
    }

    if (expiredItemVariantIds.length > 0) {
      await this.redisService
        .getClient()
        .hdel(HOT_UNIVERSE_OVERRIDES_KEY, ...expiredItemVariantIds);
    }

    return overrides;
  }

  async setHotOverride(
    input: SetHotUniverseOverrideInput,
  ): Promise<ScannerUniverseOverrideMutationDto> {
    const expiresAt =
      input.ttlHours !== undefined
        ? new Date(Date.now() + input.ttlHours * 60 * 60 * 1000).toISOString()
        : undefined;
    const record: StoredHotUniverseOverrideRecord = {
      itemVariantId: input.itemVariantId,
      createdAt: new Date().toISOString(),
      createdByUserId: input.createdByUserId,
      ...(input.note ? { note: input.note.trim() } : {}),
      ...(expiresAt ? { expiresAt } : {}),
    };

    await this.redisService
      .getClient()
      .hset(
        HOT_UNIVERSE_OVERRIDES_KEY,
        input.itemVariantId,
        JSON.stringify(record),
      );

    return {
      itemVariantId: input.itemVariantId,
      action: 'set',
    };
  }

  async clearHotOverride(
    itemVariantId: string,
  ): Promise<ScannerUniverseOverrideMutationDto> {
    await this.redisService
      .getClient()
      .hdel(HOT_UNIVERSE_OVERRIDES_KEY, itemVariantId);

    return {
      itemVariantId,
      action: 'cleared',
    };
  }

  private parseStoredRecord(
    rawValue: string,
  ): StoredHotUniverseOverrideRecord | null {
    try {
      const parsedValue = JSON.parse(
        rawValue,
      ) as Partial<StoredHotUniverseOverrideRecord>;

      if (
        typeof parsedValue.itemVariantId !== 'string' ||
        typeof parsedValue.createdAt !== 'string' ||
        typeof parsedValue.createdByUserId !== 'string'
      ) {
        return null;
      }

      return parsedValue as StoredHotUniverseOverrideRecord;
    } catch {
      return null;
    }
  }

  private isExpired(record: StoredHotUniverseOverrideRecord): boolean {
    if (!record.expiresAt) {
      return false;
    }

    return new Date(record.expiresAt).getTime() <= Date.now();
  }

  private toOverrideDto(
    record: StoredHotUniverseOverrideRecord,
  ): ScannerUniverseManualOverrideDto {
    return {
      tier: 'hot',
      createdAt: new Date(record.createdAt),
      createdByUserId: record.createdByUserId,
      ...(record.note ? { note: record.note } : {}),
      ...(record.expiresAt ? { expiresAt: new Date(record.expiresAt) } : {}),
    };
  }
}
