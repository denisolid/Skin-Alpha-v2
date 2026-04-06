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
    case 'steam-snapshot':
      return 'Steam Snapshot';
    case 'backup-aggregator':
      return 'Backup';
  }
}

export function getSourcePairLabel(sourcePairKey: string): [string, string] {
  const [buySource, sellSource] = sourcePairKey.split('->');

  return [buySource ?? 'unknown', sellSource ?? 'unknown'];
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
