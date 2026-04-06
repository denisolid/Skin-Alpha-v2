import Link from 'next/link';

import { OpportunityDetailPanel } from '../../components/opportunity-detail-panel';
import { OpportunitiesTable } from '../../components/opportunities-table';
import {
  readNumberSearchParam,
  readSearchParam,
} from '../../lib/search-params';
import {
  getCurrentUser,
  getCurrentSubscription,
  getOpportunityDetail,
  getOpportunityFeed,
} from '../../lib/server-api';

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
      key === 'selectedItemVariantId' ||
      key === 'selectedSourcePair' ||
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
  const selectedItemVariantId = readSearchParam(
    params,
    'selectedItemVariantId',
  );
  const selectedSourcePair = readSearchParam(params, 'selectedSourcePair');
  const preservedQueryString = buildSearchString(params, {});

  const feed =
    currentUser && hasFullFeedAccess
      ? await getOpportunityFeed({
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
          authenticated: true,
        })
      : await getOpportunityFeed({
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
        });

  const selectedDetail =
    currentUser &&
    hasFullFeedAccess &&
    selectedItemVariantId &&
    selectedSourcePair
      ? await getOpportunityDetail({
          itemVariantId: selectedItemVariantId,
          sourcePair: selectedSourcePair,
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
                ? 'Authenticated view with full economics and detail access.'
                : 'Signed in on the limited free tier. Detail routes and full economics require full access.'
              : 'Public view with limited fields. Sign in for item detail, watchlists, and account tools.'}
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
              <span className="badge">{feed.summary.eligible} eligible</span>
              <span className="badge">
                {feed.summary.nearEligible} near eligible
              </span>
              <span className="badge">
                {feed.summary.riskyHighUpside} high upside
              </span>
            </div>
          </div>

          <OpportunitiesTable
            detailAccess={
              currentUser ? (hasFullFeedAccess ? 'full' : 'upgrade') : 'sign-in'
            }
            items={feed.items}
            queryString={preservedQueryString}
            selectedItemVariantId={selectedItemVariantId}
            selectedSourcePair={selectedSourcePair}
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

        <aside className="panel card">
          {selectedDetail ? (
            <OpportunityDetailPanel compact item={selectedDetail} />
          ) : selectedItemVariantId &&
            selectedSourcePair &&
            currentUser &&
            !hasFullFeedAccess ? (
            <div className="callout">
              This account is on the limited feed. Upgrade access to open the
              selected opportunity detail panel.
            </div>
          ) : selectedItemVariantId && selectedSourcePair && !currentUser ? (
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
