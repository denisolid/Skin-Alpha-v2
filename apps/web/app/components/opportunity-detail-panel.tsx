import Link from 'next/link';

import {
  formatCurrency,
  formatDateTime,
  formatPercent,
  formatScore,
  getConfidenceTone,
  getFetchModeLabel,
  getRiskTone,
  getSourcePairLabel,
} from '../lib/format';
import type { OpportunityFullFeedItem } from '../lib/types';

interface OpportunityDetailPanelProps {
  readonly item: OpportunityFullFeedItem;
  readonly compact?: boolean;
}

function resolveMarketActionUrl(
  leg: OpportunityFullFeedItem['buy'],
): string | undefined {
  return leg.marketUrl ?? leg.listingUrl;
}

function OpportunityLegCard({
  label,
  leg,
}: {
  readonly label: string;
  readonly leg: OpportunityFullFeedItem['buy'];
}) {
  return (
    <div className="detail-card">
      <div className="stack-row">
        <strong>{label}</strong>
        <span className="badge source-pill">{leg.sourceName}</span>
      </div>
      <p className="meta-text">
        Ask {formatCurrency(leg.ask)} / Bid {formatCurrency(leg.bid)} / Qty{' '}
        {leg.listedQty ?? 'n/a'}
      </p>
      <p className="meta-text">
        {getFetchModeLabel(leg.fetchMode)} / {formatScore(leg.confidence)}{' '}
        confidence / {formatDateTime(leg.observedAt)}
      </p>
    </div>
  );
}

export function OpportunityDetailPanel({
  item,
  compact = false,
}: OpportunityDetailPanelProps) {
  const [buySource, sellSource] = getSourcePairLabel(item.sourcePairKey);
  const buyMarketUrl = resolveMarketActionUrl(item.buy);
  const sellMarketUrl = resolveMarketActionUrl(item.sell);

  return (
    <section className="panel card detail-layout">
      <div className="detail-section">
        <div className="stack-row">
          <span className="eyebrow">Opportunity Detail</span>
          <div className="badge-row">
            <span className={`badge ${getRiskTone(item.riskClass)}`}>
              {item.riskClass}
            </span>
            <span
              className={`badge ${getConfidenceTone(item.finalConfidence)}`}
            >
              {formatScore(item.finalConfidence)} confidence
            </span>
          </div>
        </div>

        <div>
          <h1>{item.variantDisplayName}</h1>
          <p className="panel-subtitle">
            {item.canonicalDisplayName} / {item.category}
          </p>
        </div>

        <div className="pair-badge">
          <span>{buySource}</span>
          <span>{sellSource}</span>
        </div>
      </div>

      <div className="detail-metric-grid">
        <div className="metric-card">
          <span className="metric-label">Expected Net</span>
          <strong>{formatCurrency(item.expectedNetProfit)}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">Fees-Adjusted Spread</span>
          <strong>{formatCurrency(item.feesAdjustedSpread)}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">Raw Spread</span>
          <strong>
            {formatCurrency(item.rawSpread)} /{' '}
            {formatPercent(item.rawSpreadPercent)}
          </strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">Observed</span>
          <strong>{formatDateTime(item.observedAt)}</strong>
        </div>
      </div>

      <div className="detail-list">
        <OpportunityLegCard label="Buy leg" leg={item.buy} />
        <OpportunityLegCard label="Sell leg" leg={item.sell} />
      </div>

      {item.penalties ? (
        <div className="detail-card">
          <strong>Penalty Breakdown</strong>
          <p className="meta-text">
            Freshness {formatPercent(item.penalties.freshnessPenalty)} /
            Liquidity {formatPercent(item.penalties.liquidityPenalty)} / Stale{' '}
            {formatPercent(item.penalties.stalePenalty)}
          </p>
          <p className="meta-text">
            Category {formatPercent(item.penalties.categoryPenalty)} /
            Disagreement{' '}
            {formatPercent(item.penalties.sourceDisagreementPenalty)} / Total{' '}
            {formatPercent(item.penalties.totalPenalty)}
          </p>
        </div>
      ) : null}

      {item.backupConfirmation ? (
        <div className="detail-card">
          <strong>Backup Confirmation</strong>
          <p className="meta-text">
            {item.backupConfirmation.sourceName} reference price{' '}
            {formatCurrency(item.backupConfirmation.referencePrice)} supports
            this opportunity band.
          </p>
        </div>
      ) : null}

      <div className="opportunity-actions">
        {buyMarketUrl ? (
          <a
            className="button-secondary"
            href={buyMarketUrl}
            rel="noreferrer"
            target="_blank"
          >
            Open Buy Market
          </a>
        ) : (
          <span className="button-secondary button-disabled">
            Buy Market Unavailable
          </span>
        )}
        {sellMarketUrl ? (
          <a
            className="button-secondary"
            href={sellMarketUrl}
            rel="noreferrer"
            target="_blank"
          >
            Open Sell Market
          </a>
        ) : (
          <span className="button-secondary button-disabled">
            Sell Market Unavailable
          </span>
        )}
        {!compact ? (
          <Link
            className="button-secondary"
            href={`/watchlists?itemVariantId=${encodeURIComponent(
              item.itemVariantId,
            )}&canonicalDisplayName=${encodeURIComponent(
              item.canonicalDisplayName,
            )}&variantDisplayName=${encodeURIComponent(item.variantDisplayName)}`}
          >
            Add To Watchlists
          </Link>
        ) : null}
        <Link
          className="button-ghost"
          href={`/opportunities/${item.itemVariantId}?sourcePair=${encodeURIComponent(
            item.sourcePairKey,
          )}`}
        >
          Open Full Detail
        </Link>
      </div>
    </section>
  );
}
