import {
  SOURCE_ADAPTER_KEYS,
  type SourceAdapterKey,
} from '../../source-adapters/domain/source-adapter.types';

const OPPORTUNITY_KEY_PREFIX = 'opp';
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface OpportunityKeyParts {
  readonly itemVariantId: string;
  readonly buySource: SourceAdapterKey;
  readonly sellSource: SourceAdapterKey;
  readonly sourcePairKey: string;
}

export function buildOpportunityKey(input: {
  readonly itemVariantId: string;
  readonly buySource: SourceAdapterKey;
  readonly sellSource: SourceAdapterKey;
}): string {
  return [
    OPPORTUNITY_KEY_PREFIX,
    input.itemVariantId,
    input.buySource,
    input.sellSource,
  ].join('_');
}

export function parseOpportunityKey(
  opportunityKey: string,
): OpportunityKeyParts | null {
  const [prefix, itemVariantId, buySource, sellSource, ...rest] =
    opportunityKey.split('_');

  if (
    prefix !== OPPORTUNITY_KEY_PREFIX ||
    !itemVariantId ||
    !buySource ||
    !sellSource ||
    rest.length > 0
  ) {
    return null;
  }

  if (!UUID_V4_PATTERN.test(itemVariantId)) {
    return null;
  }

  if (
    !SOURCE_ADAPTER_KEYS.includes(buySource as SourceAdapterKey) ||
    !SOURCE_ADAPTER_KEYS.includes(sellSource as SourceAdapterKey)
  ) {
    return null;
  }

  return {
    itemVariantId,
    buySource: buySource as SourceAdapterKey,
    sellSource: sellSource as SourceAdapterKey,
    sourcePairKey: `${buySource}->${sellSource}`,
  };
}
