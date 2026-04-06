import Link from 'next/link';
import { redirect } from 'next/navigation';

import { OpportunityDetailPanel } from '../../../components/opportunity-detail-panel';
import { readSearchParam } from '../../../lib/search-params';
import {
  getCurrentSubscription,
  getCurrentUser,
  getOpportunityDetail,
} from '../../../lib/server-api';

interface OpportunityDetailPageProps {
  params: Promise<{
    itemVariantId: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function OpportunityDetailPage({
  params,
  searchParams,
}: OpportunityDetailPageProps) {
  const [currentUser, currentSubscription] = await Promise.all([
    getCurrentUser(),
    getCurrentSubscription(),
  ]);

  if (!currentUser) {
    redirect('/login');
  }

  const hasFullFeedAccess =
    currentUser.role === 'ADMIN' ||
    Boolean(currentSubscription?.entitlements.fullFeed);

  const { itemVariantId } = await params;
  const resolvedSearchParams = await searchParams;
  const sourcePair = readSearchParam(resolvedSearchParams, 'sourcePair');

  if (!sourcePair) {
    return (
      <section className="panel card">
        <h1>Missing source pair</h1>
        <p className="panel-subtitle">
          Opportunity detail requires a `sourcePair` query parameter.
        </p>
        <div className="hero-actions">
          <Link className="button-secondary" href="/opportunities">
            Back To Feed
          </Link>
        </div>
      </section>
    );
  }

  if (!hasFullFeedAccess) {
    return (
      <section className="panel card">
        <h1>Full feed access required</h1>
        <p className="panel-subtitle">
          Opportunity detail is reserved for `full_access` accounts. The free
          tier can still browse the limited feed.
        </p>
        <div className="hero-actions">
          <Link className="button-primary" href="/account/settings">
            Open Account Settings
          </Link>
          <Link className="button-secondary" href="/opportunities">
            Back To Feed
          </Link>
        </div>
      </section>
    );
  }

  const detail = await getOpportunityDetail({
    itemVariantId,
    sourcePair,
  });

  if (!detail) {
    return (
      <section className="panel card">
        <h1>Opportunity unavailable</h1>
        <p className="panel-subtitle">
          This opportunity could not be loaded from the authenticated feed.
        </p>
        <div className="hero-actions">
          <Link className="button-secondary" href="/opportunities">
            Back To Feed
          </Link>
        </div>
      </section>
    );
  }

  return <OpportunityDetailPanel item={detail} />;
}
