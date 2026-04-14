import type {
  OpportunityRiskClass,
  OpportunitySourceLeg,
  SourceAdapterKey,
} from './types';

const shortTimeFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export function formatCurrency(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) {
    return 'n/a';
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value < 10 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatPercent(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) {
    return 'n/a';
  }

  return `${value.toFixed(1)}%`;
}

export function formatScore(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) {
    return 'n/a';
  }

  return `${Math.round(value * 100)}%`;
}

export function formatDateTime(value: string | undefined): string {
  if (!value) {
    return 'n/a';
  }

  return shortTimeFormatter.format(new Date(value));
}

export function formatDurationMs(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) {
    return 'n/a';
  }

  if (value < 1000) {
    return `${Math.round(value)} ms`;
  }

  const totalSeconds = Math.round(value / 1000);

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function getRiskTone(riskClass: OpportunityRiskClass): string {
  switch (riskClass) {
    case 'low':
      return 'risk-low';
    case 'medium':
      return 'risk-medium';
    case 'high':
      return 'risk-high';
    case 'extreme':
      return 'risk-extreme';
  }
}

export function getConfidenceTone(confidence: number): string {
  if (confidence >= 0.75) {
    return 'confidence-high';
  }

  if (confidence >= 0.5) {
    return 'confidence-medium';
  }

  return 'confidence-low';
}

export function formatSourceName(source: SourceAdapterKey): string {
  switch (source) {
    case 'skinport':
      return 'Skinport';
    case 'csfloat':
      return 'CSFloat';
    case 'dmarket':
      return 'DMarket';
    case 'waxpeer':
      return 'Waxpeer';
    case 'youpin':
      return 'YouPin';
    case 'bitskins':
      return 'BitSkins';
    case 'c5game':
      return 'C5Game';
    case 'csmoney':
      return 'CS.MONEY';
    case 'steam-snapshot':
      return 'Steam Snapshot';
    case 'backup-aggregator':
      return 'Backup';
  }
}

export function getSourcePairLabel(sourcePairKey: string): [string, string] {
  const [buySource, sellSource] = sourcePairKey.split('->');

  return [
    buySource ? formatSourceName(buySource as SourceAdapterKey) : 'unknown',
    sellSource ? formatSourceName(sellSource as SourceAdapterKey) : 'unknown',
  ];
}

export function getFetchModeLabel(
  fetchMode: OpportunitySourceLeg['fetchMode'],
): string {
  switch (fetchMode) {
    case 'live':
      return 'Live';
    case 'snapshot':
      return 'Snapshot';
    case 'fallback':
      return 'Fallback';
    case 'backup':
      return 'Backup';
  }
}

export function formatTokenLabel(value: string | undefined): string {
  if (!value) {
    return 'n/a';
  }

  return value.replace(/_/g, ' ');
}
