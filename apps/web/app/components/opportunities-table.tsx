import Link from 'next/link';

import {
  formatCurrency,
  formatDateTime,
  formatScore,
  getConfidenceTone,
  getRiskTone,
  getSourcePairLabel,
} from '../lib/format';
import type {
  OpportunityFullFeedItem,
  OpportunityPublicFeedItem,
} from '../lib/types';

interface OpportunitiesTableProps {
  readonly items: readonly (
    | OpportunityPublicFeedItem
    | OpportunityFullFeedItem
  )[];
  readonly selectedItemVariantId?: string | undefined;
  readonly selectedSourcePair?: string | undefined;
  readonly queryString?: string | undefined;
  readonly detailAccess: 'full' | 'upgrade' | 'sign-in';
}

export function OpportunitiesTable({
  items,
  selectedItemVariantId,
  selectedSourcePair,
  queryString,
  detailAccess,
}: OpportunitiesTableProps) {
  if (items.length === 0) {
    return (
      <div className="empty-state">
        No opportunities matched the current filters. Loosen profit or
        confidence thresholds and try again.
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
            const isActive =
              item.itemVariantId === selectedItemVariantId &&
              item.sourcePairKey === selectedSourcePair;
            const selectionParams = new URLSearchParams(queryString ?? '');

            selectionParams.set('selectedItemVariantId', item.itemVariantId);
            selectionParams.set('selectedSourcePair', item.sourcePairKey);

            return (
              <tr
                key={`${item.itemVariantId}:${item.sourcePairKey}`}
                className={`table-row${isActive ? ' table-row-active' : ''}`}
              >
                <td>
                  <div className="item-name">
                    <strong>{item.variantDisplayName}</strong>
                    <div className="item-meta">
                      <span>{item.canonicalDisplayName}</span>
                      <span className="tier-pill">{item.tier}</span>
                    </div>
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
                        href={`/opportunities/${item.itemVariantId}?sourcePair=${encodeURIComponent(
                          item.sourcePairKey,
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
