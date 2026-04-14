import Link from 'next/link';

import {
  formatCurrency,
  formatDateTime,
  formatTokenLabel,
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
  const executionPenaltyTotal =
    item.execution.fees +
    item.execution.slippagePenalty +
    item.execution.liquidityPenalty +
    item.execution.uncertaintyPenalty;

  return (
    <section className="panel card detail-layout">
      <div className="detail-section">
        <div className="stack-row">
          <span className="eyebrow">Opportunity Detail</span>
          <div className="badge-row">
            <span className={`badge ${getRiskTone(item.riskClass)}`}>
              {item.riskClass}
            </span>
            <span className="badge source-pill">
              {formatTokenLabel(item.surfaceTier)}
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
        <p className="meta-text">
          Parser flow: source adapters ingest raw payloads, normalize them into
          market state, then the opportunity engine filters and ranks tradable
          pairs for this feed.
        </p>
        {item.blockerReason ? (
          <p className="meta-text">
            Current blocker: {formatTokenLabel(item.blockerReason)}.
          </p>
        ) : null}
      </div>

      <div className="detail-metric-grid">
        <div className="metric-card">
          <span className="metric-label">Expected Net</span>
          <strong>{formatCurrency(item.expectedNetProfit)}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">Execution Penalties</span>
          <strong>{formatCurrency(executionPenaltyTotal)}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">Raw Spread</span>
          <strong>
            {formatCurrency(item.rawSpread)} / {item.rawSpreadPercent.toFixed(1)}
            %
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

      <div className="detail-card">
        <strong>Execution Breakdown</strong>
        <p className="meta-text">
          Realized sell {formatCurrency(item.execution.realizedSellPrice)} /
          Buy {formatCurrency(item.execution.buyPrice)} / Fees{' '}
          {formatCurrency(item.execution.fees)}
        </p>
        <p className="meta-text">
          Slippage {formatCurrency(item.execution.slippagePenalty)} / Liquidity{' '}
          {formatCurrency(item.execution.liquidityPenalty)} / Uncertainty{' '}
          {formatCurrency(item.execution.uncertaintyPenalty)}
        </p>
      </div>

      <div className="detail-card">
        <strong>Quality Signals</strong>
        <p className="meta-text">
          Mapping {formatScore(item.componentScores.mappingConfidence)} / Price{' '}
          {formatScore(item.componentScores.priceConfidence)} / Liquidity{' '}
          {formatScore(item.componentScores.liquidityConfidence)}
        </p>
        <p className="meta-text">
          Freshness {formatScore(item.componentScores.freshnessConfidence)} /
          Source reliability{' '}
          {formatScore(item.componentScores.sourceReliabilityConfidence)} /
          Variant match{' '}
          {formatScore(item.componentScores.variantMatchConfidence)}
        </p>
      </div>

      <div className="detail-card">
        <strong>Tradability Gate</strong>
        <p className="meta-text">
          Strict match {item.strictTradable.matched ? 'passed' : 'failed'} /
          pre-score gate {item.preScoreGate.passed ? 'passed' : 'failed'} /
          pairability {formatTokenLabel(item.pairability.status)}
        </p>
        <p className="meta-text">
          Eligibility {item.eligibility.eligible ? 'eligible' : 'blocked'} /
          reference support{' '}
          {item.eligibility.requiresReferenceSupport ? 'required' : 'not required'}
          {' / '}
          steam demoted{' '}
          {item.eligibility.steamSnapshotDemoted ? 'yes' : 'no'}
        </p>
      </div>

      {item.riskReasons.length > 0 ? (
        <div className="detail-card">
          <strong>Risk Reasons</strong>
          {item.riskReasons.map((reason) => (
            <p key={`${reason.code}:${reason.detail}`} className="meta-text">
              {formatTokenLabel(reason.severity)}: {formatTokenLabel(reason.code)}{' '}
              / {reason.detail}
            </p>
          ))}
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
          href={`/opportunities/${encodeURIComponent(item.opportunityKey)}`}
        >
          Open Full Detail
        </Link>
      </div>
    </section>
  );
}
