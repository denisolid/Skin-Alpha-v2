import 'server-only';

import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { SERVER_API_BASE_URL, SESSION_COOKIE_NAME } from './server-config';
import type {
  CurrentUser,
  CurrentSubscription,
  OpportunityFullFeedItem,
  OpportunityFullFeedPage,
  OpportunityPublicFeedPage,
  OpportunityRejectDiagnosticsPage,
  SourceOperationalSummary,
  WatchlistsResponse,
} from './types';

type SearchValue = string | number | undefined;

interface OpportunityFeedQuery {
  readonly sourcePair?: string;
  readonly category?: string;
  readonly minProfit?: number;
  readonly minConfidence?: number;
  readonly itemType?: string;
  readonly tier?: string;
  readonly page?: number;
  readonly pageSize?: number;
  readonly sortBy?: string;
  readonly sortDirection?: string;
}

interface ServerApiRequestOptions {
  readonly searchParams?: Record<string, SearchValue>;
  readonly authenticated?: boolean;
  readonly nullableStatuses?: readonly number[];
}

const DEV_STARTUP_FETCH_RETRY_DELAYS_MS = [
  200, 400, 800, 1200, 2000, 3000,
] as const;

export class ServerApiRequestError extends Error {
  readonly path: string;
  readonly status: number | 'error';
  readonly responseBody: string | undefined;

  constructor(input: {
    readonly path: string;
    readonly status: number | 'error';
    readonly message: string;
    readonly responseBody?: string;
  }) {
    super(input.message);
    this.name = 'ServerApiRequestError';
    this.path = input.path;
    this.status = input.status;
    this.responseBody = input.responseBody;
  }
}

function buildQueryString(
  searchParams: Record<string, SearchValue> | undefined,
): string {
  if (!searchParams) {
    return '';
  }

  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined || value === '') {
      continue;
    }

    params.set(key, String(value));
  }

  const serialized = params.toString();

  return serialized.length > 0 ? `?${serialized}` : '';
}

async function getSessionCookieHeader(): Promise<string | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionToken) {
    return null;
  }

  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken)}`;
}

function extractServerApiErrorMessage(
  payloadText: string,
  path: string,
  status: number,
): string {
  const fallbackMessage = `Backend request failed for ${path} (${status}).`;
  const trimmedPayload = payloadText.trim();

  if (trimmedPayload.length === 0) {
    return fallbackMessage;
  }

  try {
    const payload = JSON.parse(trimmedPayload) as Record<string, unknown>;
    const message = payload.message;

    if (Array.isArray(message) && message.length > 0) {
      return `${fallbackMessage} ${message.join(', ')}`;
    }

    if (typeof message === 'string' && message.trim().length > 0) {
      return `${fallbackMessage} ${message.trim()}`;
    }

    const error = payload.error;

    if (typeof error === 'string' && error.trim().length > 0) {
      return `${fallbackMessage} ${error.trim()}`;
    }
  } catch {
    // Fall back to the raw body below when the backend did not return JSON.
  }

  const compactPayload = trimmedPayload.replace(/\s+/g, ' ').slice(0, 240);

  return `${fallbackMessage} ${compactPayload}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetriableFetchFailure(error: unknown): boolean {
  const seen = new Set<unknown>();
  const retriableCodes = new Set([
    'ECONNREFUSED',
    'ECONNRESET',
    'EAI_AGAIN',
    'ENOTFOUND',
    'ETIMEDOUT',
  ]);

  const visit = (value: unknown): boolean => {
    if (value === null || value === undefined || seen.has(value)) {
      return false;
    }

    if (typeof value === 'string') {
      return value.includes('fetch failed');
    }

    if (typeof value !== 'object') {
      return false;
    }

    seen.add(value);

    if (
      'code' in value &&
      typeof (value as { code?: unknown }).code === 'string' &&
      retriableCodes.has((value as { code: string }).code)
    ) {
      return true;
    }

    if (
      'message' in value &&
      typeof (value as { message?: unknown }).message === 'string' &&
      (value as { message: string }).message.includes('fetch failed')
    ) {
      return true;
    }

    if ('cause' in value && visit((value as { cause?: unknown }).cause)) {
      return true;
    }

    if (
      'errors' in value &&
      Array.isArray((value as { errors?: unknown }).errors) &&
      (value as { errors: unknown[] }).errors.some((entry) => visit(entry))
    ) {
      return true;
    }

    return false;
  };

  return visit(error);
}

async function serverApiRequest<TResponse>(
  path: string,
  options: ServerApiRequestOptions = {},
): Promise<TResponse | null> {
  const headers = new Headers();
  const requestPath = `${path}${buildQueryString(options.searchParams)}`;
  const startedAt = Date.now();
  let responseStatus: number | 'error' = 'error';

  if (options.authenticated) {
    const cookieHeader = await getSessionCookieHeader();

    if (!cookieHeader) {
      return null;
    }

    headers.set('cookie', cookieHeader);
  }

  try {
    let response: Response | undefined;

    for (let attempt = 0; attempt <= DEV_STARTUP_FETCH_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        response = await fetch(`${SERVER_API_BASE_URL}${requestPath}`, {
          cache: 'no-store',
          headers,
        });
        break;
      } catch (error) {
        const shouldRetry =
          process.env.NODE_ENV === 'development' &&
          attempt < DEV_STARTUP_FETCH_RETRY_DELAYS_MS.length &&
          isRetriableFetchFailure(error);

        if (!shouldRetry) {
          throw error;
        }

        await delay(DEV_STARTUP_FETCH_RETRY_DELAYS_MS[attempt]!);
      }
    }

    if (!response) {
      throw new Error(`Backend request failed for ${path} before receiving a response.`);
    }

    responseStatus = response.status;

    if (
      response.status === 401 ||
      options.nullableStatuses?.includes(response.status)
    ) {
      return null;
    }

    if (!response.ok) {
      const responseText = await response.text().catch(() => '');

      throw new ServerApiRequestError({
        path,
        status: response.status,
        message: extractServerApiErrorMessage(
          responseText,
          path,
          response.status,
        ),
        ...(responseText.length > 0 ? { responseBody: responseText } : {}),
      });
    }

    return (await response.json()) as TResponse;
  } finally {
    if (process.env.NODE_ENV !== 'test') {
      console.info(
        `[web][server-api] ${requestPath} status=${responseStatus} durationMs=${Date.now() - startedAt}`,
      );
    }
  }
}

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> =>
  serverApiRequest<CurrentUser>('/auth/me', {
    authenticated: true,
    nullableStatuses: [401],
  }),
);

export const getCurrentSubscription = cache(
  async (): Promise<CurrentSubscription | null> =>
    serverApiRequest<CurrentSubscription>('/subscriptions/me', {
      authenticated: true,
      nullableStatuses: [401],
    }),
);

export async function requireCurrentUser(): Promise<CurrentUser> {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    redirect('/login');
  }

  return currentUser;
}

export async function getOpportunityFeed<
  TAuthenticated extends boolean | undefined,
>(
  query: OpportunityFeedQuery & {
    readonly authenticated?: TAuthenticated;
  },
): Promise<
  TAuthenticated extends true
    ? OpportunityFullFeedPage
    : OpportunityPublicFeedPage
> {
  const endpoint = query.authenticated
    ? '/opportunities/feed/full'
    : '/opportunities/feed';

  return (await serverApiRequest<
    OpportunityPublicFeedPage | OpportunityFullFeedPage
  >(endpoint, {
    ...(query.authenticated !== undefined
      ? { authenticated: query.authenticated }
      : {}),
    searchParams: {
      ...(query.sourcePair ? { sourcePair: query.sourcePair } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.minProfit !== undefined ? { minProfit: query.minProfit } : {}),
      ...(query.minConfidence !== undefined
        ? { minConfidence: query.minConfidence }
        : {}),
      ...(query.itemType ? { itemType: query.itemType } : {}),
      ...(query.tier ? { tier: query.tier } : {}),
      ...(query.page !== undefined ? { page: query.page } : {}),
      ...(query.pageSize !== undefined ? { pageSize: query.pageSize } : {}),
      ...(query.sortBy ? { sortBy: query.sortBy } : {}),
      ...(query.sortDirection ? { sortDirection: query.sortDirection } : {}),
    },
  })) as TAuthenticated extends true
    ? OpportunityFullFeedPage
    : OpportunityPublicFeedPage;
}

export async function getOpportunityDetail(input: {
  readonly opportunityKey: string;
}): Promise<OpportunityFullFeedItem | null> {
  return serverApiRequest<OpportunityFullFeedItem>(
    `/opportunities/feed/${encodeURIComponent(input.opportunityKey)}`,
    {
      authenticated: true,
      nullableStatuses: [403, 404],
    },
  );
}

export async function getOpportunityRejectDiagnostics(
  query: OpportunityFeedQuery = {},
): Promise<OpportunityRejectDiagnosticsPage | null> {
  return serverApiRequest<OpportunityRejectDiagnosticsPage>(
    '/opportunities/internal/reject-diagnostics',
    {
      authenticated: true,
      nullableStatuses: [401, 403],
      searchParams: {
        ...(query.sourcePair ? { sourcePair: query.sourcePair } : {}),
        ...(query.category ? { category: query.category } : {}),
        ...(query.minProfit !== undefined ? { minProfit: query.minProfit } : {}),
        ...(query.minConfidence !== undefined
          ? { minConfidence: query.minConfidence }
          : {}),
        ...(query.itemType ? { itemType: query.itemType } : {}),
        ...(query.tier ? { tier: query.tier } : {}),
        ...(query.page !== undefined ? { page: query.page } : {}),
        ...(query.pageSize !== undefined ? { pageSize: query.pageSize } : {}),
        ...(query.sortBy ? { sortBy: query.sortBy } : {}),
        ...(query.sortDirection ? { sortDirection: query.sortDirection } : {}),
      },
    },
  );
}

export async function getSourceOperationalSummary(): Promise<SourceOperationalSummary | null> {
  return serverApiRequest<SourceOperationalSummary>(
    '/diagnostics/sources/summary',
    {
      authenticated: true,
      nullableStatuses: [401, 403],
    },
  );
}

export async function getWatchlists(): Promise<WatchlistsResponse | null> {
  return serverApiRequest<WatchlistsResponse>('/watchlists', {
    authenticated: true,
    nullableStatuses: [401],
  });
}
