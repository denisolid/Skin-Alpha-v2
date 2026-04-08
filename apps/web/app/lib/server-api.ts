import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { SERVER_API_BASE_URL, SESSION_COOKIE_NAME } from './server-config';
import type {
  CurrentUser,
  CurrentSubscription,
  OpportunityFullFeedItem,
  OpportunityFullFeedPage,
  OpportunityPublicFeedPage,
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

async function serverApiRequest<TResponse>(
  path: string,
  options: ServerApiRequestOptions = {},
): Promise<TResponse | null> {
  const headers = new Headers();

  if (options.authenticated) {
    const cookieHeader = await getSessionCookieHeader();

    if (!cookieHeader) {
      return null;
    }

    headers.set('cookie', cookieHeader);
  }

  const response = await fetch(
    `${SERVER_API_BASE_URL}${path}${buildQueryString(options.searchParams)}`,
    {
      cache: 'no-store',
      headers,
    },
  );

  if (
    response.status === 401 ||
    options.nullableStatuses?.includes(response.status)
  ) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Backend request failed for ${path} (${response.status}).`);
  }

  return (await response.json()) as TResponse;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  return serverApiRequest<CurrentUser>('/auth/me', {
    authenticated: true,
    nullableStatuses: [401],
  });
}

export async function getCurrentSubscription(): Promise<CurrentSubscription | null> {
  return serverApiRequest<CurrentSubscription>('/subscriptions/me', {
    authenticated: true,
    nullableStatuses: [401],
  });
}

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
  readonly itemVariantId: string;
  readonly sourcePair: string;
}): Promise<OpportunityFullFeedItem | null> {
  return serverApiRequest<OpportunityFullFeedItem>(
    `/opportunities/feed/variants/${input.itemVariantId}/detail`,
    {
      authenticated: true,
      nullableStatuses: [403, 404],
      searchParams: {
        sourcePair: input.sourcePair,
      },
    },
  );
}

export async function getWatchlists(): Promise<WatchlistsResponse | null> {
  return serverApiRequest<WatchlistsResponse>('/watchlists', {
    authenticated: true,
    nullableStatuses: [401],
  });
}
