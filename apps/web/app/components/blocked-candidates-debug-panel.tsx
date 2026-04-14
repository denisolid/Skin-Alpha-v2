import {
  formatCurrency,
  formatScore,
  formatTokenLabel,
  getSourcePairLabel,
} from '../lib/format';
import type { OpportunityRejectDiagnosticsPage } from '../lib/types';

interface BlockedCandidatesDebugPanelProps {
  readonly rejectDiagnostics: OpportunityRejectDiagnosticsPage;
}

export function BlockedCandidatesDebugPanel({
  rejectDiagnostics,
}: BlockedCandidatesDebugPanelProps) {
  if (rejectDiagnostics.items.length === 0) {
    return null;
  }

  return (
    <section className="panel card">
      <div className="stack-row">
        <div>
          <h2>Blocked Pair Samples</h2>
          <p className="panel-subtitle">
            Admin debug view of rejected pairs from the current market slice.
            Threshold filters are ignored here so hard blockers stay visible.
          </p>
        </div>
        <span className="badge">
          {rejectDiagnostics.totalRejected} rejected pairs
        </span>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Source Pair</th>
              <th>Primary Stage</th>
              <th>Class</th>
              <th>Blocker</th>
              <th>Pairability</th>
              <th>Expected Net</th>
              <th>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {rejectDiagnostics.items.map((item) => {
              const [buySource, sellSource] = getSourcePairLabel(
                item.sourcePairKey,
              );
              const strictIdentityDetails = item.strictIdentityDetails;
              const buySignalSummary = `ask ${item.buy.ask !== undefined ? 'yes' : 'no'} / bid ${item.buy.bid !== undefined ? 'yes' : 'no'} / qty ${item.buy.listedQty ?? 'n/a'}`;
              const sellSignalSummary = `ask ${item.sell.ask !== undefined ? 'yes' : 'no'} / bid ${item.sell.bid !== undefined ? 'yes' : 'no'} / qty ${item.sell.listedQty ?? 'n/a'}`;
              const missingSignalSummary = item.missingMarketSignalRejected
                ? item.reasonCodes.includes('buy_source_has_no_ask')
                  ? `${buySource} buy ask missing`
                  : `${sellSource} exit signal missing`
                : null;

              return (
                <tr key={item.opportunityKey}>
                  <td>
                    <div className="item-name">
                      <strong>{item.variantDisplayName}</strong>
                      <div className="item-meta">
                        <span>{item.canonicalDisplayName}</span>
                      </div>
                      <div className="item-meta">
                        {item.failedOnlyBecauseStrictVariantKey ? (
                          <span>strict-key-only</span>
                        ) : null}
                        {item.failedOnlyBecauseStale ? (
                          <span>stale-only</span>
                        ) : null}
                        {item.failedOnlyBecauseListedExit ? (
                          <span>listed-exit-only</span>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="pair-badge">
                      <span>{buySource}</span>
                      <span>{sellSource}</span>
                    </div>
                  </td>
                  <td>{formatTokenLabel(item.primaryRejectStage)}</td>
                  <td>{formatTokenLabel(item.blockerClass)}</td>
                  <td>
                    <div className="item-meta">
                      <span>
                        pre:{' '}
                        {formatTokenLabel(
                          item.prePairRejectReason ?? item.primaryRejectStage,
                        )}
                      </span>
                      {strictIdentityDetails ? (
                        <span>
                          strict:{' '}
                          {strictIdentityDetails.status === 'missing_key'
                            ? 'missing-key'
                            : strictIdentityDetails.differingFields.join(', ')}
                        </span>
                      ) : null}
                      <span>
                        post:{' '}
                        {formatTokenLabel(
                          item.postPairRejectReason ??
                            item.blockerReason ??
                            'n/a',
                        )}
                      </span>
                      {strictIdentityDetails &&
                      item.strictTradable.buyKey &&
                      item.strictTradable.sellKey ? (
                        <span>
                          {buySource}:{' '}
                          {item.strictTradable.buyKey.floatBucket}/
                          {item.strictTradable.buyKey.patternSensitiveBucket}{' '}
                          vs {sellSource}:{' '}
                          {item.strictTradable.sellKey.floatBucket}/
                          {item.strictTradable.sellKey.patternSensitiveBucket}
                        </span>
                      ) : null}
                      {missingSignalSummary ? <span>{missingSignalSummary}</span> : null}
                      {item.listedExitOnly ? (
                        <span>{sellSource} exit uses listed ask only</span>
                      ) : null}
                      <span>{buySource}: {buySignalSummary}</span>
                      <span>{sellSource}: {sellSignalSummary}</span>
                    </div>
                  </td>
                  <td>
                    <div className="item-meta">
                      <span>{formatTokenLabel(item.pairability.status)}</span>
                      {item.listedExitOnly ? <span>listed-exit</span> : null}
                      {item.blockedButPresentCandidate ? (
                        <span>blocked-present</span>
                      ) : null}
                    </div>
                  </td>
                  <td>{formatCurrency(item.execution.expectedNet)}</td>
                  <td>{formatScore(item.finalConfidence)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
