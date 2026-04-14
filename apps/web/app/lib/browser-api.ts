'use client';

import { API_BASE_URL } from './config';
import type {
  CatalogBootstrapResult,
  MarketStateRebuildResult,
  OpportunityRescanResult,
  SourceAdapterKey,
  SourceSyncAccepted,
  SourceSyncBatchAccepted,
} from './types';

type JsonBody = Record<string, unknown>;

interface BrowserApiRequestOptions extends Omit<RequestInit, 'body'> {
  readonly body?: BodyInit | JsonBody | null;
}

function isJsonBody(
  value: BodyInit | JsonBody | null | undefined,
): value is JsonBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    !(value instanceof FormData) &&
    !(value instanceof URLSearchParams) &&
    !(value instanceof Blob) &&
    !(value instanceof ArrayBuffer)
  );
}

function extractApiErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return 'Request failed.';
  }

  const message = (payload as Record<string, unknown>).message;

  if (Array.isArray(message)) {
    return message.join(', ');
  }

  if (typeof message === 'string' && message.trim().length > 0) {
    return message;
  }

  const error = (payload as Record<string, unknown>).error;

  return typeof error === 'string' && error.trim().length > 0
    ? error
    : 'Request failed.';
}

export async function browserApiRequest<TResponse>(
  path: string,
  options: BrowserApiRequestOptions = {},
): Promise<TResponse> {
  const headers = new Headers(options.headers);
  const requestOptions: Omit<BrowserApiRequestOptions, 'body'> = {
    ...options,
  };
  let body = options.body;

  if (isJsonBody(body)) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(body);
  }

  const requestInit: RequestInit = {
    ...requestOptions,
    headers,
    credentials: 'include',
  };

  if (body !== undefined) {
    requestInit.body = body;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...requestInit,
  });
  const payload: unknown =
    response.status === 204
      ? null
      : await response.json().catch((): null => null);

  if (!response.ok) {
    throw new Error(extractApiErrorMessage(payload));
  }

  return payload as TResponse;
}

export function bootstrapCatalog(): Promise<CatalogBootstrapResult> {
  return browserApiRequest<CatalogBootstrapResult>('/admin/catalog/bootstrap', {
    method: 'POST',
  });
}

export function syncSource(
  source: Extract<
    SourceAdapterKey,
    'skinport' | 'csfloat' | 'dmarket' | 'waxpeer' | 'steam-snapshot'
  >,
): Promise<SourceSyncAccepted> {
  return browserApiRequest<SourceSyncAccepted>(
    `/admin/sources/sync/${source}`,
    {
      method: 'POST',
    },
  );
}

export function syncAllSources(): Promise<SourceSyncBatchAccepted> {
  return browserApiRequest<SourceSyncBatchAccepted>('/admin/sources/sync/all', {
    method: 'POST',
  });
}

export function rebuildMarketState(): Promise<MarketStateRebuildResult> {
  return browserApiRequest<MarketStateRebuildResult>(
    '/admin/market-state/rebuild',
    {
      method: 'POST',
    },
  );
}

export function rescanOpportunities(): Promise<OpportunityRescanResult> {
  return browserApiRequest<OpportunityRescanResult>(
    '/admin/opportunities/rescan',
    {
      method: 'POST',
    },
  );
}
