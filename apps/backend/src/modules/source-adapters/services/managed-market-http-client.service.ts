import { Inject, Injectable } from '@nestjs/common';

import { AppLoggerService } from '../../../infrastructure/logging/app-logger.service';
import type {
  ManagedMarketSourceDefinition,
  ManagedMarketSourceKey,
  ManagedMarketTargetDto,
} from '../domain/managed-market-source.types';
import { ManagedMarketSourceDefinitionsService } from './managed-market-source-definitions.service';
import { ManagedMarketSourceRuntimeService } from './managed-market-source-runtime.service';

export class ManagedMarketHttpError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly responseBody?: unknown,
  ) {
    super(message);
  }
}

@Injectable()
export class ManagedMarketHttpClientService {
  constructor(
    @Inject(AppLoggerService)
    private readonly logger: AppLoggerService,
    @Inject(ManagedMarketSourceDefinitionsService)
    private readonly definitionsService: ManagedMarketSourceDefinitionsService,
    @Inject(ManagedMarketSourceRuntimeService)
    private readonly runtimeService: ManagedMarketSourceRuntimeService,
  ) {}

  async fetchListingsSnapshot(input: {
    readonly source: ManagedMarketSourceKey;
    readonly targets: readonly ManagedMarketTargetDto[];
    readonly page?: number;
  }): Promise<unknown> {
    const definition = this.definitionsService.get(input.source);
    const url = this.buildListingsUrl(definition, input.targets, input.page);
    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders(definition),
    });

    await this.runtimeService.recordResponse(input.source, response.headers);

    const payload = await this.readPayload(response);

    if (!response.ok) {
      throw new ManagedMarketHttpError(
        `${definition.displayName} request failed for ${definition.requestPath}: ${JSON.stringify(payload)}`,
        response.status,
        payload,
      );
    }

    this.logger.debug(
      `Fetched ${definition.displayName} listings snapshot from ${url}.`,
      ManagedMarketHttpClientService.name,
    );

    return payload;
  }

  private buildListingsUrl(
    definition: ManagedMarketSourceDefinition,
    targets: readonly ManagedMarketTargetDto[],
    page?: number,
  ): string {
    const url = new URL(
      definition.requestPath.replace(/^\/+/, ''),
      `${definition.baseUrl.replace(/\/+$/, '')}/`,
    );

    url.searchParams.set('limit', String(definition.pageLimit));
    url.searchParams.set('scanner_mode', 'overlap-aware');
    url.searchParams.set('source_overlap', '1');
    url.searchParams.set('batch_size', String(targets.length));

    if (page !== undefined) {
      url.searchParams.set('page', String(page));
    }

    if (targets.length > 0) {
      url.searchParams.set(
        'market_hash_names',
        targets.map((target) => target.marketHashName).join(','),
      );
      url.searchParams.set(
        'item_variant_ids',
        targets.map((target) => target.itemVariantId).join(','),
      );
      url.searchParams.set(
        'priority_reasons',
        [...new Set(targets.map((target) => target.priorityReason))].join(','),
      );
    }

    return url.toString();
  }

  private buildHeaders(
    definition: ManagedMarketSourceDefinition,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'SkinAlpha-v2-scanner/1.0',
    };

    if (definition.apiKey) {
      headers.Authorization = `Bearer ${definition.apiKey}`;
      headers['X-API-Key'] = definition.apiKey;
    }

    return headers;
  }

  private async readPayload(response: Response): Promise<unknown> {
    const contentType = response.headers.get('content-type') ?? '';

    if (/application\/json/i.test(contentType)) {
      return response.json();
    }

    const text = await response.text();

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}
