import Link from 'next/link';
import { Suspense } from 'react';

import {
  AdminRejectDiagnosticsFallback,
  AdminRejectDiagnosticsSection,
} from '../../components/admin-reject-diagnostics-section';
import { OpportunityDetailPanel } from '../../components/opportunity-detail-panel';
import { OpportunitiesTable } from '../../components/opportunities-table';
import { createEmptyOpportunityFeedPage } from '../../lib/opportunity-feed-fallback';
import {
  readNumberSearchParam,
  readSearchParam,
} from '../../lib/search-params';
import {
  getCurrentUser,
  getCurrentSubscription,
  getOpportunityDetail,
  getOpportunityFeed,
  getOpportunityRejectDiagnostics,
} from '../../lib/server-api';
import type {
  OpportunityFullFeedItem,
  OpportunityPublicFeedItem,
} from '../../lib/types';

interface OpportunitiesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const categoryOptions = ['SKIN', 'KNIFE', 'GLOVE', 'CASE', 'CAPSULE'] as const;
const tierOptions = ['hot', 'warm', 'cold'] as const;

function buildSearchString(
  params: Record<string, string | string[] | undefined>,
  overrides: Record<string, string | number | undefined>,
): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (
      key === 'selectedOpportunityKey' ||
      value === undefined
    ) {
      continue;
    }

    if (Array.isArray(value)) {
      if (value[0]) {
        search.set(key, value[0]);
      }
      continue;
    }

    search.set(key, value);
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined || value === '') {
      search.delete(key);
      continue;
    }

    search.set(key, String(value));
  }

  return search.toString();
}

export default async function OpportunitiesPage({
  searchParams,
}: OpportunitiesPageProps) {
  const params = await searchParams;
  const [currentUser, currentSubscription] = await Promise.all([
    getCurrentUser(),
    getCurrentSubscription(),
  ]);
  const hasFullFeedAccess =
    currentUser?.role === 'ADMIN' ||
    Boolean(currentSubscription?.entitlements.fullFeed);
  const sourcePair = readSearchParam(params, 'sourcePair');
  const category = readSearchParam(params, 'category');
  const minProfit = readNumberSearchParam(params, 'minProfit');
  const minConfidence = readNumberSearchParam(params, 'minConfidence');
  const itemType = readSearchParam(params, 'itemType');
  const tier = readSearchParam(params, 'tier');
  const page = readNumberSearchParam(params, 'page') ?? 1;
  const pageSize = readNumberSearchParam(params, 'pageSize') ?? 25;
  const sortBy = readSearchParam(params, 'sortBy') ?? 'expected_profit';
  const sortDirection = readSearchParam(params, 'sortDirection') ?? 'desc';
  const selectedOpportunityKey = readSearchParam(
    params,
    'selectedOpportunityKey',
  );
  const showRejectDiagnostics =
    readSearchParam(params, 'showRejectDiagnostics') === '1';
  const preservedQueryString = buildSearchString(params, {});
  const feedQuery = {
    ...(sourcePair ? { sourcePair } : {}),
    ...(category ? { category } : {}),
    ...(minProfit !== undefined ? { minProfit } : {}),
    ...(minConfidence !== undefined ? { minConfidence } : {}),
    ...(itemType ? { itemType } : {}),
    ...(tier ? { tier } : {}),
    page,
    pageSize,
    sortBy,
    sortDirection,
  };
  let feedErrorMessage: string | null = null;
  const feed =
    currentUser && hasFullFeedAccess
      ? await getOpportunityFeed({
          ...feedQuery,
          authenticated: true,
        }).catch((error: unknown) => {
          feedErrorMessage =
            error instanceof Error
              ? error.message
              : 'Unable to load opportunities feed.';

          return createEmptyOpportunityFeedPage<OpportunityFullFeedItem>({
            ...feedQuery,
          });
        })
      : await getOpportunityFeed(feedQuery).catch((error: unknown) => {
          feedErrorMessage =
            error instanceof Error
              ? error.message
              : 'Unable to load opportunities feed.';

          return createEmptyOpportunityFeedPage<OpportunityPublicFeedItem>({
            ...feedQuery,
          });
        });
  const rejectDiagnosticsPromise =
    currentUser?.role === 'ADMIN' &&
    showRejectDiagnostics &&
    !feedErrorMessage &&
    feed.items.length === 0
      ? getOpportunityRejectDiagnostics({
          ...(sourcePair ? { sourcePair } : {}),
          ...(category ? { category } : {}),
          ...(itemType ? { itemType } : {}),
          ...(tier ? { tier } : {}),
          page: 1,
          pageSize: 8,
          sortBy,
          sortDirection,
        }).catch(() => null)
      : Promise.resolve(null);
  let selectedDetailErrorMessage: string | null = null;
  const selectedDetail =
    currentUser && hasFullFeedAccess && selectedOpportunityKey
      ? await getOpportunityDetail({
          opportunityKey: selectedOpportunityKey,
        }).catch((error: unknown) => {
          selectedDetailErrorMessage =
            error instanceof Error
              ? error.message
              : 'Unable to load selected opportunity detail.';
          return null;
        })
      : null;

  const previousPageHref =
    feed.pageInfo.page > 1
      ? `/opportunities?${buildSearchString(params, {
          page: feed.pageInfo.page - 1,
        })}`
      : null;
  const nextPageHref =
    feed.pageInfo.page < feed.pageInfo.totalPages
      ? `/opportunities?${buildSearchString(params, {
          page: feed.pageInfo.page + 1,
        })}`
      : null;

  return (
    <>
      <section className="page-header">
        <div>
          <span className="eyebrow">Opportunities Feed</span>
          <h1>Scanner feed from normalized market state.</h1>
          <p>
            {currentUser
              ? hasFullFeedAccess
                ? 'Authenticated view with parser-backed economics and detail access. Source adapters fetch raw market data, normalization updates market state, and this feed filters the downstream opportunity set.'
                : 'Signed in on the limited free tier. The parser still ingests full market data, but detail routes and full economics require full access.'
              : 'Public view with limited fields. Sign in for item detail, watchlists, and parser-backed diagnostics.'}
          </p>
        </div>
        <div className="hero-actions">
          {!currentUser ? (
            <Link className="button-primary" href="/login">
              Sign In For Full Feed
            </Link>
          ) : !hasFullFeedAccess ? (
            <Link className="button-primary" href="/account/settings">
              Upgrade Access
            </Link>
          ) : null}
          <Link className="button-secondary" href="/watchlists">
            Watchlists
          </Link>
        </div>
      </section>

      <section className="page-grid">
        <aside className="panel card">
          <h2>Filters</h2>
          <p className="panel-subtitle">
            Filter by pair, category, thresholds, and scanner tier.
          </p>

          <form className="filters-form" method="get">
            <input name="pageSize" type="hidden" value={pageSize} />

            <div className="filters-grid">
              <div className="field">
                <label htmlFor="sourcePair">Source pair</label>
                <input
                  defaultValue={sourcePair}
                  id="sourcePair"
                  name="sourcePair"
                  placeholder="skinport->csfloat"
                />
              </div>
              <div className="field">
                <label htmlFor="category">Category</label>
                <select
                  defaultValue={category ?? ''}
                  id="category"
                  name="category"
                >
                  <option value="">All categories</option>
                  {categoryOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="itemType">Item type</label>
                <input
                  defaultValue={itemType}
                  id="itemType"
                  name="itemType"
                  placeholder="AK-47, Butterfly Knife, Case"
                />
              </div>
              <div className="field">
                <label htmlFor="tier">Tier</label>
                <select defaultValue={tier ?? ''} id="tier" name="tier">
                  <option value="">All tiers</option>
                  {tierOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="minProfit">Minimum profit</label>
                <input
                  defaultValue={minProfit}
                  id="minProfit"
                  min="0"
                  name="minProfit"
                  step="0.01"
                  type="number"
                />
              </div>
              <div className="field">
                <label htmlFor="minConfidence">Minimum confidence</label>
                <input
                  defaultValue={minConfidence}
                  id="minConfidence"
                  max="1"
                  min="0"
                  name="minConfidence"
                  step="0.01"
                  type="number"
                />
              </div>
              <div className="field">
                <label htmlFor="sortBy">Sort by</label>
                <select defaultValue={sortBy} id="sortBy" name="sortBy">
                  <option value="expected_profit">Expected profit</option>
                  <option value="confidence">Confidence</option>
                  <option value="freshness">Freshness</option>
                  <option value="liquidity">Liquidity</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="sortDirection">Direction</label>
                <select
                  defaultValue={sortDirection}
                  id="sortDirection"
                  name="sortDirection"
                >
                  <option value="desc">Descending</option>
                  <option value="asc">Ascending</option>
                </select>
              </div>
            </div>

            <div className="watchlist-actions">
              <button className="button-primary" type="submit">
                Apply Filters
              </button>
              <Link className="button-ghost" href="/opportunities">
                Reset
              </Link>
            </div>
          </form>
        </aside>

        <section className="panel card">
          <div className="stack-row">
            <div>
              <h2>Market Matrix Feed</h2>
              <p className="panel-subtitle">
                {feed.pageInfo.total} rows / page {feed.pageInfo.page} of{' '}
                {feed.pageInfo.totalPages}
              </p>
            </div>
            <div className="badge-row">
              <span className="badge">{feed.summary.tradable} tradable</span>
              <span className="badge">
                {feed.summary.referenceBacked} reference backed
              </span>
              <span className="badge">{feed.summary.eligible} eligible</span>
              <span className="badge">
                {feed.summary.nearEligibleTier} near eligible tier
              </span>
              <span className="badge">{feed.summary.research} research</span>
            </div>
          </div>

          {feedErrorMessage ? (
            <div className="form-error">
              {feedErrorMessage} The page is showing an empty fallback view
              until the backend recovers.
            </div>
          ) : null}

          <OpportunitiesTable
            detailAccess={
              currentUser ? (hasFullFeedAccess ? 'full' : 'upgrade') : 'sign-in'
            }
            diagnostics={feed.diagnostics}
            items={feed.items}
            queryString={preservedQueryString}
            selectedOpportunityKey={selectedOpportunityKey}
          />

          <div className="pagination-bar">
            <span className="footer-note">
              Sorted by {feed.pageInfo.sortBy} {feed.pageInfo.sortDirection}.
            </span>
            <div className="watchlist-actions">
              {previousPageHref ? (
                <Link className="button-ghost" href={previousPageHref}>
                  Previous Page
                </Link>
              ) : (
                <span className="button-ghost button-disabled">
                  Previous Page
                </span>
              )}
              {nextPageHref ? (
                <Link className="button-secondary" href={nextPageHref}>
                  Next Page
                </Link>
              ) : (
                <span className="button-secondary button-disabled">
                  Next Page
                </span>
              )}
            </div>
          </div>
        </section>

        {currentUser?.role === 'ADMIN' && feed.items.length === 0 ? (
          showRejectDiagnostics ? (
            <Suspense fallback={<AdminRejectDiagnosticsFallback />}>
              <AdminRejectDiagnosticsSection
                rejectDiagnosticsPromise={rejectDiagnosticsPromise}
              />
            </Suspense>
          ) : (
            <section className="panel card">
              <div className="stack-row">
                <div>
                  <h2>Blocked Pair Samples</h2>
                  <p className="panel-subtitle">
                    Rejected-pair diagnostics are available on demand so empty
                    feed pages do not trigger a second backend scan by default.
                  </p>
                </div>
                <Link
                  className="button-ghost"
                  href={`/opportunities?${buildSearchString(params, {
                    page: 1,
                    showRejectDiagnostics: 1,
                  })}`}
                >
                  Load Blocked Pair Samples
                </Link>
              </div>
              <div className="callout">
                Empty admin feeds no longer auto-fetch reject diagnostics during
                the initial page render.
              </div>
            </section>
          )
        ) : null}

        <aside className="panel card">
          {selectedDetail ? (
            <OpportunityDetailPanel compact item={selectedDetail} />
          ) : selectedDetailErrorMessage ? (
            <div className="form-error">{selectedDetailErrorMessage}</div>
          ) : selectedOpportunityKey && currentUser && !hasFullFeedAccess ? (
            <div className="callout">
              This account is on the limited feed. Upgrade access to open the
              selected opportunity detail panel.
            </div>
          ) : selectedOpportunityKey && !currentUser ? (
            <div className="callout">
              Sign in to inspect the selected row in the detail panel and access
              the dedicated opportunity detail page.
            </div>
          ) : (
            <div className="callout">
              Select a row from the feed to inspect a detailed buy or sell panel
              here.
            </div>
          )}
        </aside>
      </section>
    </>
  );
}
