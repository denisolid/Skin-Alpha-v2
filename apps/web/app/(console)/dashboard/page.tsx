import Link from 'next/link';
import { Suspense } from 'react';

import { AdminMarketStartupPanel } from '../../components/admin-market-startup-panel';
import {
  AdminSourceOperationalSummaryFallback,
  AdminSourceOperationalSummarySection,
} from '../../components/admin-source-operational-summary-section';
import { OpportunitiesTable } from '../../components/opportunities-table';
import {
  formatCurrency,
  formatScore,
} from '../../lib/format';
import { createEmptyOpportunityFeedPage } from '../../lib/opportunity-feed-fallback';
import {
  getCurrentSubscription,
  getOpportunityFeed,
  getSourceOperationalSummary,
  getWatchlists,
  requireCurrentUser,
} from '../../lib/server-api';
import { readSearchParam } from '../../lib/search-params';
import type {
  OpportunityFullFeedItem,
  OpportunityPublicFeedItem,
} from '../../lib/types';

interface DashboardPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DashboardPage({
  searchParams,
}: DashboardPageProps) {
  const params = searchParams ? await searchParams : {};
  const currentUser = await requireCurrentUser();
  const currentSubscriptionPromise = getCurrentSubscription();
  const watchlistsPromise = getWatchlists();
  const showSourceSummary = readSearchParam(params, 'showSourceSummary') === '1';
  const sourceSummaryPromise =
    currentUser.role === 'ADMIN' && showSourceSummary
      ? getSourceOperationalSummary()
      : Promise.resolve(null);
  let feedErrorMessage: string | null = null;
  const feedPromise =
    currentUser.role === 'ADMIN'
      ? getOpportunityFeed({
          authenticated: true,
          page: 1,
          pageSize: 8,
          sortBy: 'expected_profit',
          sortDirection: 'desc',
        }).catch((error: unknown) => {
          feedErrorMessage =
            error instanceof Error
                ? error.message
                : 'Unable to load recent opportunities.';

          return createEmptyOpportunityFeedPage<OpportunityFullFeedItem>({
            page: 1,
            pageSize: 8,
            sortBy: 'expected_profit',
            sortDirection: 'desc',
          });
        })
      : currentSubscriptionPromise.then((currentSubscription) =>
          currentSubscription?.entitlements.fullFeed
            ? getOpportunityFeed({
                authenticated: true,
                page: 1,
                pageSize: 8,
                sortBy: 'expected_profit',
                sortDirection: 'desc',
              }).catch((error: unknown) => {
                feedErrorMessage =
                  error instanceof Error
                  ? error.message
                    : 'Unable to load recent opportunities.';

                return createEmptyOpportunityFeedPage<OpportunityFullFeedItem>({
                  page: 1,
                  pageSize: 8,
                  sortBy: 'expected_profit',
                  sortDirection: 'desc',
                });
              })
            : getOpportunityFeed({
                page: 1,
                pageSize: 8,
                sortBy: 'expected_profit',
                sortDirection: 'desc',
              }).catch((error: unknown) => {
                feedErrorMessage =
                  error instanceof Error
                  ? error.message
                    : 'Unable to load recent opportunities.';

                return createEmptyOpportunityFeedPage<OpportunityPublicFeedItem>({
                  page: 1,
                  pageSize: 8,
                  sortBy: 'expected_profit',
                  sortDirection: 'desc',
                });
              }),
        );
  const [currentSubscription, watchlists, feed] = await Promise.all([
    currentSubscriptionPromise,
    watchlistsPromise,
    feedPromise,
  ]);
  const hasFullFeedAccess =
    currentUser.role === 'ADMIN' ||
    Boolean(currentSubscription?.entitlements.fullFeed);

  const topOpportunity = feed.items[0];
  const watchlistCount = watchlists?.watchlists.length ?? 0;
  const trackedItemCount =
    watchlists?.watchlists.reduce(
      (total, watchlist) => total + watchlist.itemCount,
      0,
    ) ?? 0;

  return (
    <>
      <section className="page-header">
        <div>
          <span className="eyebrow">Dashboard</span>
          <h1>Scanner operating view.</h1>
          <p>
            Signed in as{' '}
            {currentUser.displayName ?? currentUser.email ?? 'operator'}. This
            dashboard pulls from internal normalized market state and your
            personal watchlists.
            {hasFullFeedAccess
              ? ' Full feed access is enabled for this account.'
              : ' This account is currently on the limited feed.'}
          </p>
        </div>
        <div className="hero-actions">
          <Link className="button-primary" href="/opportunities">
            Open Feed
          </Link>
          <Link className="button-secondary" href="/watchlists">
            Manage Watchlists
          </Link>
        </div>
      </section>

      <section className="dashboard-grid">
        <article className="panel card metric-card">
          <span className="metric-label">Eligible Now</span>
          <strong>{feed.summary.eligible}</strong>
          <span className="muted">Current high-confidence opportunities.</span>
        </article>
        <article className="panel card metric-card">
          <span className="metric-label">Tradable Tier</span>
          <strong>{feed.summary.tradable}</strong>
          <span className="muted">
            Opportunities that passed strict tradable matching.
          </span>
        </article>
        <article className="panel card metric-card">
          <span className="metric-label">Watchlists</span>
          <strong>
            {watchlistCount} / {trackedItemCount}
          </strong>
          <span className="muted">
            Lists and tracked variants in your account.
          </span>
        </article>
        <article className="panel card metric-card">
          <span className="metric-label">Best Current Net</span>
          <strong>
            {topOpportunity
              ? formatCurrency(topOpportunity.expectedNetProfit)
              : 'n/a'}
          </strong>
          <span className="muted">
            {topOpportunity
              ? `${formatScore(topOpportunity.finalConfidence)} confidence`
              : 'No eligible records in the current page window.'}
          </span>
        </article>
      </section>

      <AdminMarketStartupPanel user={currentUser} />

      {currentUser.role === 'ADMIN' ? (
        showSourceSummary ? (
          <Suspense fallback={<AdminSourceOperationalSummaryFallback />}>
            <AdminSourceOperationalSummarySection
              sourceSummaryPromise={sourceSummaryPromise}
            />
          </Suspense>
        ) : (
          <section className="panel card">
            <div className="stack-row">
              <div>
                <h2>Parser Slice</h2>
                <p className="panel-subtitle">
                  Source operational diagnostics are available on demand so they
                  do not compete with the main feed during first paint.
                </p>
              </div>
              <Link className="button-ghost" href="/dashboard?showSourceSummary=1">
                Load Parser Diagnostics
              </Link>
            </div>
            <div className="callout">
              Heavy diagnostics are paused on initial dashboard load while the
              read path is being stabilized.
            </div>
          </section>
        )
      ) : null}

      <section className="page-grid-two">
        <article className="panel card">
          <div className="stack-row">
            <div>
              <h2>Recent Opportunities</h2>
              <p className="panel-subtitle">
                {hasFullFeedAccess
                  ? 'Highest-ranked results from the full authenticated feed.'
                  : 'Highest-ranked results from the limited free feed.'}
              </p>
            </div>
          </div>
          {feedErrorMessage ? (
            <div className="form-error">
              {feedErrorMessage} The dashboard is showing an empty fallback
              feed until the backend request succeeds again.
            </div>
          ) : null}
          <OpportunitiesTable
            detailAccess={hasFullFeedAccess ? 'full' : 'upgrade'}
            diagnostics={feed.diagnostics}
            items={feed.items}
          />
        </article>

        <article className="panel card">
          <h2>Operator Snapshot</h2>
          <p className="panel-subtitle">
            Minimal account and feed summary for daily use.
          </p>

          <div className="detail-list">
            <div className="detail-card">
              <strong>Account</strong>
              <p className="meta-text">
                {currentUser.email ?? 'No email set'} / {currentUser.role} /{' '}
                {currentUser.identities.length} identities linked
              </p>
            </div>
            <div className="detail-card">
              <strong>Feed Access</strong>
              <p className="meta-text">
                {hasFullFeedAccess
                  ? 'Full authenticated feed enabled.'
                  : 'Limited feed active. Upgrade for detailed economics and item panels.'}
              </p>
            </div>
            <div className="detail-card">
              <strong>Best Opportunity</strong>
              <p className="meta-text">
                {topOpportunity
                  ? `${topOpportunity.variantDisplayName} at ${formatCurrency(
                      topOpportunity.expectedNetProfit,
                    )}`
                  : 'No current opportunity in this slice.'}
              </p>
            </div>
          </div>
        </article>
      </section>
    </>
  );
}
