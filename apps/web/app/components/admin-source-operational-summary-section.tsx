import {
  formatDateTime,
  formatDurationMs,
  formatPercent,
} from '../lib/format';
import type { SourceOperationalSummary } from '../lib/types';

interface AdminSourceOperationalSummarySectionProps {
  readonly sourceSummaryPromise: Promise<SourceOperationalSummary | null>;
}

export async function AdminSourceOperationalSummarySection({
  sourceSummaryPromise,
}: AdminSourceOperationalSummarySectionProps) {
  const sourceSummary = await sourceSummaryPromise;

  if (!sourceSummary) {
    return (
      <section className="panel card">
        <div className="callout">
          Source operational diagnostics are unavailable for this account.
        </div>
      </section>
    );
  }

  return (
    <section className="panel card">
      <div className="stack-row">
        <div>
          <h2>Parser Slice</h2>
          <p className="panel-subtitle">
            Raw market collection volume flowing into normalized state and then
            into the opportunity feed.
          </p>
        </div>
        <div className="badge-row">
          <span className="badge">
            {sourceSummary.variantsWithTwoPlusSources} 2+ source variants
          </span>
          <span className="badge">
            {sourceSummary.variantsWithThreePlusSources} 3+ source variants
          </span>
        </div>
      </div>
      <div className="detail-list">
        {sourceSummary.sources.slice(0, 6).map((source) => (
          <div key={source.source} className="detail-card">
            <strong>{source.sourceName}</strong>
            <p className="meta-text">
              Raw {source.rawPayloadArchivesCount} / Listings{' '}
              {source.sourceListingsCount} / Facts {source.sourceMarketFactsCount}
              {' / '}Snapshots {source.marketSnapshotsCount} / State{' '}
              {source.marketStatesCount}
            </p>
            <p className="meta-text">
              Pending mappings {source.pendingMappingsCount} / Last raw{' '}
              {formatDateTime(source.latestRawPayloadObservedAt)} / Last state{' '}
              {formatDateTime(source.latestMarketStateObservedAt)}
            </p>
            <p className="meta-text">
              Lag {formatDurationMs(source.rawToStateLagMs)} / Amplification{' '}
              {source.projectionAmplificationRatio?.toFixed(2) ?? 'n/a'}x / Useful{' '}
              {formatPercent(source.usefulPayloadRatio)}
            </p>
            <p className="meta-text">
              Unchanged skips {source.unchangedProjectionSkipCount} / Last
              normalized {formatDateTime(source.latestNormalizedAt)}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function AdminSourceOperationalSummaryFallback() {
  return (
    <section className="panel card">
      <div className="stack-row">
        <div>
          <h2>Parser Slice</h2>
          <p className="panel-subtitle">
            Loading source operational diagnostics separately from the initial
            dashboard render.
          </p>
        </div>
        <span className="badge">Loading</span>
      </div>
      <div className="callout">
        Heavy source diagnostics are still available, but they no longer block
        the first dashboard paint.
      </div>
    </section>
  );
}
