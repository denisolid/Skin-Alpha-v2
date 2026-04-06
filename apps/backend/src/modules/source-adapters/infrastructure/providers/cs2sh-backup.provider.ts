import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

import { AppConfigService } from '../../../../infrastructure/config/app-config.service';
import type {
  BackupReferenceFetchBatchInput,
  BackupReferenceProvider,
  BackupReferenceProviderDescriptor,
} from '../../domain/backup-reference-provider.interface';
import { BackupReferenceProviderThrottleError } from '../../domain/backup-reference-provider.interface';
import type {
  BackupReferenceNormalizationResultDto,
  BackupReferenceObservationDto,
  BackupReferenceProviderFetchResultDto,
} from '../../dto/backup-aggregator.dto';
import type { ArchivedRawPayloadDto } from '../../dto/archived-raw-payload.dto';
import type {
  Cs2ShArchivedBatchPayloadDto,
  Cs2ShLatestPriceItemDto,
  Cs2ShLatestPricesRequestDto,
  Cs2ShLatestPricesResponseDto,
  Cs2ShQuoteDto,
} from '../../dto/cs2sh-backup.dto';
import { BackupAggregatorRateLimitService } from '../../services/backup-aggregator-rate-limit.service';

const CS2SH_BACKUP_LATEST_PRICES_ENDPOINT_NAME = 'cs2sh-latest-prices';

interface Cs2ShQuoteCandidate {
  readonly sourceKey: string;
  readonly askMinor: number;
  readonly listedQuantity?: number;
  readonly observedAt?: Date;
}

@Injectable()
export class Cs2ShBackupProvider implements BackupReferenceProvider {
  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
    @Inject(BackupAggregatorRateLimitService)
    private readonly backupAggregatorRateLimitService: BackupAggregatorRateLimitService,
  ) {}

  get descriptor(): BackupReferenceProviderDescriptor {
    return {
      key: 'cs2sh',
      displayName: 'cs2.sh',
      priority: 100,
      baseConfidence: 0.42,
    };
  }

  isEnabled(): boolean {
    return this.configService.isBackupAggregatorCs2ShEnabled();
  }

  getRateLimitState() {
    return this.backupAggregatorRateLimitService.getProviderState(
      this.descriptor.key,
    );
  }

  async fetchBatch(
    input: BackupReferenceFetchBatchInput,
  ): Promise<BackupReferenceProviderFetchResultDto> {
    const currentRateLimitState = await this.getRateLimitState();

    if (
      (currentRateLimitState.status === 'cooldown' ||
        currentRateLimitState.status === 'blocked') &&
      currentRateLimitState.retryAfterSeconds !== undefined
    ) {
      throw new BackupReferenceProviderThrottleError(
        this.descriptor.key,
        currentRateLimitState.retryAfterSeconds,
      );
    }

    const requestUrl = new URL(
      'v1/prices/latest',
      `${this.configService.backupAggregatorCs2ShApiBaseUrl.replace(/\/+$/, '')}/`,
    );
    const requestBody: Cs2ShLatestPricesRequestDto = {
      items: input.batch.targets.map((target) => target.marketHashName),
      ...(this.configService.backupAggregatorCs2ShReferenceSources.length > 0
        ? {
            sources: this.configService.backupAggregatorCs2ShReferenceSources,
          }
        : {}),
    };

    // Configure the base URL and bearer token in the backup aggregator env vars.
    // cs2.sh is treated as a reference-only provider behind this generic adapter.
    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.configService.backupAggregatorCs2ShApiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(
        this.configService.backupAggregatorCs2ShRequestTimeoutMs,
      ),
    });

    if (response.status === 429) {
      const retryAfterSeconds = this.readRetryAfter(response.headers);

      await this.backupAggregatorRateLimitService.recordProviderState(
        this.descriptor.key,
        {
          status: 'cooldown',
          checkedAt: new Date(),
          ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
          ...(retryAfterSeconds !== undefined
            ? {
                resetsAt: new Date(Date.now() + retryAfterSeconds * 1000),
              }
            : {}),
        },
      );

      throw new BackupReferenceProviderThrottleError(
        this.descriptor.key,
        retryAfterSeconds,
        'cs2.sh quota or throttle window is active.',
      );
    }

    if (!response.ok) {
      const responseBody = await response.text();

      throw new ServiceUnavailableException(
        `cs2.sh latest prices request failed: ${responseBody}`,
      );
    }

    const responsePayload =
      (await response.json()) as Partial<Cs2ShLatestPricesResponseDto>;

    await this.syncQuotaState(responsePayload);

    return {
      providerKey: this.descriptor.key,
      endpointName: CS2SH_BACKUP_LATEST_PRICES_ENDPOINT_NAME,
      observedAt: this.readObservedAt(responsePayload),
      httpStatus: response.status,
      payload: {
        batchId: input.batch.batchId,
        requestedAt: input.requestedAt,
        observedAt: new Date().toISOString(),
        targets: input.batch.targets,
        selectedSources:
          this.configService.backupAggregatorCs2ShReferenceSources,
        response: responsePayload,
      } satisfies Cs2ShArchivedBatchPayloadDto,
      warnings: [],
    };
  }

  normalizeArchivedPayload(
    archive: ArchivedRawPayloadDto,
  ): BackupReferenceNormalizationResultDto {
    if (archive.endpointName !== CS2SH_BACKUP_LATEST_PRICES_ENDPOINT_NAME) {
      return {
        providerKey: this.descriptor.key,
        observations: [],
        warnings: [`Unsupported backup endpoint ${archive.endpointName}.`],
      };
    }

    const payload = this.isArchivedBatchPayload(archive.payload)
      ? archive.payload
      : null;

    if (!payload) {
      return {
        providerKey: this.descriptor.key,
        observations: [],
        warnings: ['Invalid cs2.sh backup payload.'],
      };
    }

    const itemEntries = this.readItemEntries(payload.response);
    const observations: BackupReferenceObservationDto[] = [];
    const warnings: string[] = [];

    for (const target of payload.targets) {
      const entry =
        itemEntries.get(target.marketHashName) ??
        [...itemEntries.values()].find(
          (item) => item.market_hash_name === target.marketHashName,
        );

      if (!entry) {
        warnings.push(
          `cs2.sh did not return a backup price for ${target.marketHashName}.`,
        );
        continue;
      }

      const observation = this.normalizeItem(
        archive,
        target,
        payload.selectedSources,
        entry,
        payload.response.response_time,
      );

      if (!observation) {
        warnings.push(
          `cs2.sh returned an unusable backup quote for ${target.marketHashName}.`,
        );
        continue;
      }

      observations.push(observation);
    }

    return {
      providerKey: this.descriptor.key,
      observations,
      warnings,
    };
  }

  private async syncQuotaState(
    responsePayload: Partial<Cs2ShLatestPricesResponseDto>,
  ): Promise<void> {
    await this.backupAggregatorRateLimitService.recordProviderState(
      this.descriptor.key,
      {
        status:
          responsePayload.quota?.remaining !== undefined &&
          responsePayload.quota.remaining <= 0
            ? 'limited'
            : 'available',
        checkedAt: new Date(),
        ...(responsePayload.quota?.remaining !== undefined
          ? { windowRemaining: responsePayload.quota.remaining }
          : {}),
        ...(responsePayload.quota?.resets_at
          ? { resetsAt: new Date(responsePayload.quota.resets_at) }
          : {}),
      },
    );
  }

  private normalizeItem(
    archive: ArchivedRawPayloadDto,
    target: Cs2ShArchivedBatchPayloadDto['targets'][number],
    selectedSources: readonly string[],
    itemEntry: Cs2ShLatestPriceItemDto,
    responseTime?: string,
  ): BackupReferenceObservationDto | null {
    const quoteCandidates = this.collectQuoteCandidates(
      itemEntry,
      selectedSources,
    );

    if (quoteCandidates.length === 0) {
      return null;
    }

    const sortedQuotes = [...quoteCandidates].sort(
      (left, right) => left.askMinor - right.askMinor,
    );
    const referenceQuote =
      sortedQuotes[Math.floor(sortedQuotes.length / 2)] ?? sortedQuotes[0];

    if (!referenceQuote) {
      return null;
    }
    const listingQuantity = quoteCandidates
      .map((quote) => quote.listedQuantity)
      .filter((value): value is number => value !== undefined)
      .reduce((total, value) => total + value, 0);
    const latestObservedAt =
      [...quoteCandidates]
        .map((quote) => quote.observedAt)
        .filter((value): value is Date => value instanceof Date)
        .sort((left, right) => right.getTime() - left.getTime())[0] ??
      (responseTime ? new Date(responseTime) : archive.observedAt);
    const confidence = this.deriveReferenceConfidence(
      quoteCandidates,
      selectedSources.length,
    );

    return {
      providerKey: this.descriptor.key,
      rawPayloadArchiveId: archive.id,
      canonicalItemId: target.canonicalItemId,
      itemVariantId: target.itemVariantId,
      marketHashName: target.marketHashName,
      observedAt: latestObservedAt,
      currency: 'USD',
      backupPriceMinor: referenceQuote.askMinor,
      ...(listingQuantity > 0 ? { listedQuantity: listingQuantity } : {}),
      sourceConfidence: confidence,
      sampleSize: quoteCandidates.length,
      liquidityScore:
        listingQuantity > 0 ? this.deriveLiquidityScore(listingQuantity) : 0,
      metadata: {
        providerDisplayName: this.descriptor.displayName,
        referenceOnly: true,
        notPrimaryTruth: true,
        quoteSources: quoteCandidates.map((quote) => quote.sourceKey),
        priceSelection: 'median-across-provider-sources',
        ...(sortedQuotes[0]
          ? { lowestObservedAskMinor: sortedQuotes[0].askMinor }
          : {}),
      },
    };
  }

  private collectQuoteCandidates(
    itemEntry: Cs2ShLatestPriceItemDto,
    selectedSources: readonly string[],
  ): readonly Cs2ShQuoteCandidate[] {
    const requestedSources = selectedSources.length
      ? selectedSources
      : ['steam', 'skinport', 'csfloat'];
    const quoteCandidates: Cs2ShQuoteCandidate[] = [];

    for (const sourceKey of requestedSources) {
      const sourceQuote = this.readNestedSourceQuote(itemEntry, sourceKey);

      if (sourceQuote) {
        const quoteCandidate = this.toQuoteCandidate(sourceKey, sourceQuote);

        if (quoteCandidate) {
          quoteCandidates.push(quoteCandidate);
        }
      }
    }

    if (quoteCandidates.length > 0) {
      return quoteCandidates;
    }

    const directQuote = this.toQuoteCandidate('aggregate', itemEntry);

    return directQuote ? [directQuote] : [];
  }

  private readNestedSourceQuote(
    itemEntry: Cs2ShLatestPriceItemDto,
    sourceKey: string,
  ): Cs2ShQuoteDto | null {
    const nestedSources = itemEntry.sources;

    if (
      nestedSources &&
      typeof nestedSources === 'object' &&
      !Array.isArray(nestedSources) &&
      sourceKey in nestedSources
    ) {
      const sourceQuote = nestedSources[sourceKey];

      return sourceQuote && typeof sourceQuote === 'object'
        ? sourceQuote
        : null;
    }

    const directSourceQuote =
      itemEntry[sourceKey as keyof Cs2ShLatestPriceItemDto];

    return directSourceQuote &&
      typeof directSourceQuote === 'object' &&
      !Array.isArray(directSourceQuote)
      ? (directSourceQuote as Cs2ShQuoteDto)
      : null;
  }

  private toQuoteCandidate(
    sourceKey: string,
    quote:
      | Cs2ShQuoteDto
      | Pick<
          Cs2ShLatestPriceItemDto,
          'ask' | 'ask_volume' | 'updated_at' | 'collected_at'
        >,
  ): Cs2ShQuoteCandidate | null {
    const askMinor = this.toMinorUnits(quote.ask);

    if (askMinor === undefined || askMinor <= 0) {
      return null;
    }

    return {
      sourceKey,
      askMinor,
      ...(typeof quote.ask_volume === 'number'
        ? { listedQuantity: Math.max(0, Math.trunc(quote.ask_volume)) }
        : {}),
      ...(quote.updated_at || quote.collected_at
        ? {
            observedAt: new Date(quote.updated_at ?? quote.collected_at ?? ''),
          }
        : {}),
    };
  }

  private deriveReferenceConfidence(
    quoteCandidates: readonly Cs2ShQuoteCandidate[],
    requestedSourceCount: number,
  ): number {
    const sortedPrices = [...quoteCandidates]
      .map((quote) => quote.askMinor)
      .sort((left, right) => left - right);
    const lowestPrice = sortedPrices[0] ?? 0;
    const highestPrice = sortedPrices[sortedPrices.length - 1] ?? lowestPrice;
    const medianPrice =
      sortedPrices[Math.floor(sortedPrices.length / 2)] ?? lowestPrice ?? 0;
    const priceSpreadRatio =
      medianPrice > 0 ? (highestPrice - lowestPrice) / medianPrice : 1;
    const coverageFactor =
      requestedSourceCount > 0
        ? Math.min(1, quoteCandidates.length / requestedSourceCount)
        : 0.5;
    const consistencyFactor = Math.max(0.55, 1 - priceSpreadRatio);

    return Number(
      Math.min(
        0.45,
        this.descriptor.baseConfidence * coverageFactor * consistencyFactor,
      ).toFixed(4),
    );
  }

  private deriveLiquidityScore(quantity: number): number {
    return Number(Math.min(0.6, Math.log10(quantity + 1) / 3).toFixed(4));
  }

  private readItemEntries(
    response: Cs2ShArchivedBatchPayloadDto['response'],
  ): ReadonlyMap<string, Cs2ShLatestPriceItemDto> {
    const items = response.items;

    if (!items || typeof items !== 'object' || Array.isArray(items)) {
      return new Map();
    }

    return new Map(
      Object.entries(items)
        .filter((entry): entry is [string, Cs2ShLatestPriceItemDto] => {
          const [, value] = entry;

          return Boolean(value && typeof value === 'object');
        })
        .map(([key, value]) => [key, value]),
    );
  }

  private isArchivedBatchPayload(
    value: unknown,
  ): value is Cs2ShArchivedBatchPayloadDto {
    return (
      typeof value === 'object' &&
      value !== null &&
      'batchId' in value &&
      'targets' in value &&
      Array.isArray((value as { targets?: unknown[] }).targets) &&
      'response' in value
    );
  }

  private readObservedAt(
    responsePayload: Partial<Cs2ShLatestPricesResponseDto>,
  ): Date {
    return responsePayload.response_time
      ? new Date(responsePayload.response_time)
      : new Date();
  }

  private readRetryAfter(headers: Headers): number | undefined {
    const rawValue = headers.get('retry-after');

    if (!rawValue) {
      return undefined;
    }

    const parsedValue = Number(rawValue);

    return Number.isNaN(parsedValue) ? undefined : parsedValue;
  }

  private toMinorUnits(value: number | undefined): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return undefined;
    }

    return Math.round(value * 100);
  }
}
