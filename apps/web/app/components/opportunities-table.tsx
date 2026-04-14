import Link from 'next/link';

import {
  formatTokenLabel,
  formatCurrency,
  formatDateTime,
  formatScore,
  getConfidenceTone,
  getRiskTone,
  getSourcePairLabel,
} from '../lib/format';
import type {
  OpportunityFeedDiagnostics,
  OpportunityFullFeedItem,
  OpportunityPublicFeedItem,
} from '../lib/types';

interface OpportunitiesTableProps {
  readonly items: readonly (
    | OpportunityPublicFeedItem
    | OpportunityFullFeedItem
  )[];
  readonly selectedOpportunityKey?: string | undefined;
  readonly queryString?: string | undefined;
  readonly detailAccess: 'full' | 'upgrade' | 'sign-in';
  readonly diagnostics?: OpportunityFeedDiagnostics;
  readonly sourceCoverageNote?: string;
}

export function OpportunitiesTable({
  items,
  selectedOpportunityKey,
  queryString,
  detailAccess,
  diagnostics,
  sourceCoverageNote,
}: OpportunitiesTableProps) {
  if (items.length === 0) {
    const topRejectStages =
      diagnostics?.rejectionSummary.primaryRejectStages.slice(0, 3);
    const topSourcePairs = diagnostics?.overlapBySourcePair.slice(0, 3);
    const topPipelineDiagnostics = diagnostics?.pipelineDiagnostics
      .filter((entry) => entry.count > 0)
      .slice(0, 4);

    return (
      <div className="empty-state">
        <p>No visible opportunities were produced from the current market slice.</p>
        {diagnostics ? (
          <>
            <p>
              Scanned {diagnostics.scannedVariantCount} variants and evaluated{' '}
              {diagnostics.evaluatedPairCount} source pairs. Visible feed rows:{' '}
              {diagnostics.validOpportunityCount}. Eligible rows:{' '}
              {diagnostics.feedEligibleCount}.
            </p>
            <p>
              Counter-source variants:{' '}
              {diagnostics.variantsWithCounterSourceCandidate}. Variants with
              overlap but no pairable pair:{' '}
              {
                diagnostics.rejectionSummary
                  .variantsRejectedForLowOverlapOrLowPairability
              }
              . Pairable pairs: {diagnostics.pairableCount}. Blocked before
              pairability: {diagnostics.blockedBeforePairabilityCount}. Blocked
              after pairability: {diagnostics.blockedAfterPairabilityCount}.
            </p>
            <p>
              Listed-exit-only pairs: {diagnostics.listedExitOnlyCount}. Near
              misses: {diagnostics.nearMissCandidateCount}. Blocked but present
              pairs: {diagnostics.blockedButPresentCount}.
            </p>
            <p>
              Pre-pair rejects: strict identity{' '}
              {diagnostics.strictVariantIdentityRejectCount}, expired sources{' '}
              {diagnostics.staleRejectCount}, missing market signal{' '}
              {diagnostics.missingMarketSignalRejectCount}.
            </p>
            {topSourcePairs && topSourcePairs.length > 0 ? (
              <p>
                Top source overlap:{' '}
                {topSourcePairs
                  .map(
                    (entry) =>
                      `${entry.sourcePairKey} ${entry.overlapCount} overlap / ${entry.pairableVariantCount} pairable / ${entry.blockedBeforePairabilityCount} pre-pair blocked`,
                  )
                  .join(', ')}
                .
              </p>
            ) : null}
            {topRejectStages && topRejectStages.length > 0 ? (
              <p>
                Primary reject stages:{' '}
                {topRejectStages
                  .map((entry) => `${formatTokenLabel(entry.key)} ${entry.count}`)
                  .join(', ')}
                .
              </p>
            ) : null}
            {topPipelineDiagnostics && topPipelineDiagnostics.length > 0 ? (
              <p>
                Pipeline diagnostics:{' '}
                {topPipelineDiagnostics
                  .map((entry) => `${formatTokenLabel(entry.key)} ${entry.count}`)
                  .join(', ')}
                .
              </p>
            ) : null}
            {diagnostics.hiddenByFeedQueryFilters > 0 ? (
              <p>
                Current feed filters hid {diagnostics.hiddenByFeedQueryFilters}{' '}
                otherwise visible rows.
              </p>
            ) : null}
            {sourceCoverageNote ? <p>{sourceCoverageNote}</p> : null}
          </>
        ) : (
          <p>
            No visible opportunity passed source-overlap, variant-match,
            freshness, and execution gates.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Source Pair</th>
            <th>Expected Net</th>
            <th>Confidence</th>
            <th>Risk</th>
            <th>Observed</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const [buySource, sellSource] = getSourcePairLabel(
              item.sourcePairKey,
            );
            const isActive = item.opportunityKey === selectedOpportunityKey;
            const selectionParams = new URLSearchParams(queryString ?? '');

            selectionParams.set('selectedOpportunityKey', item.opportunityKey);

            return (
              <tr
                key={item.opportunityKey}
                className={`table-row${isActive ? ' table-row-active' : ''}`}
              >
                <td>
                  <div className="item-name">
                    <strong>{item.variantDisplayName}</strong>
                    <div className="item-meta">
                      <span>{item.canonicalDisplayName}</span>
                      <span className="tier-pill">{item.tier}</span>
                      <span className="tier-pill">
                        {formatTokenLabel(item.surfaceTier)}
                      </span>
                    </div>
                    {item.blockerReason ? (
                      <div className="item-meta">
                        <span>blocker: {formatTokenLabel(item.blockerReason)}</span>
                      </div>
                    ) : null}
                  </div>
                </td>
                <td>
                  <div className="pair-badge">
                    <span>{buySource}</span>
                    <span>{sellSource}</span>
                  </div>
                </td>
                <td className="numeric-strong">
                  {formatCurrency(item.expectedNetProfit)}
                </td>
                <td>
                  <span
                    className={`badge ${getConfidenceTone(item.finalConfidence)}`}
                  >
                    {formatScore(item.finalConfidence)}
                  </span>
                </td>
                <td>
                  <span className={`badge ${getRiskTone(item.riskClass)}`}>
                    {item.riskClass}
                  </span>
                </td>
                <td>{formatDateTime(item.observedAt)}</td>
                <td>
                  <div className="watchlist-actions">
                    <Link
                      className="button-ghost"
                      href={`/opportunities?${selectionParams.toString()}`}
                    >
                      Inspect
                    </Link>
                    {detailAccess === 'full' ? (
                      <Link
                        className="button-secondary"
                        href={`/opportunities/${encodeURIComponent(
                          item.opportunityKey,
                        )}`}
                      >
                        Detail
                      </Link>
                    ) : detailAccess === 'upgrade' ? (
                      <Link
                        className="button-secondary"
                        href="/account/settings"
                      >
                        Upgrade
                      </Link>
                    ) : (
                      <Link className="button-secondary" href="/login">
                        Sign In
                      </Link>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
