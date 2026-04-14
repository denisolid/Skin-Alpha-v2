export const OPPORTUNITY_EVALUATION_DISPOSITIONS = [
  'candidate',
  'near_eligible',
  'eligible',
  'risky_high_upside',
  'rejected',
] as const;

export type OpportunityEvaluationDisposition =
  (typeof OPPORTUNITY_EVALUATION_DISPOSITIONS)[number];

export const OPPORTUNITY_REASON_CODES = [
  'meets_candidate_thresholds',
  'meets_near_eligible_thresholds',
  'meets_eligible_thresholds',
  'high_upside_with_elevated_risk',
  'buy_source_has_no_ask',
  'sell_source_has_no_exit_signal',
  'buy_sell_same_source',
  'non_positive_raw_spread',
  'negative_fees_adjusted_spread',
  'near_equal_after_fees',
  'true_non_positive_edge',
  'expected_net_below_category_floor',
  'spread_percent_below_category_floor',
  'confidence_below_candidate_floor',
  'confidence_below_eligible_floor',
  'freshness_penalty_elevated',
  'liquidity_penalty_elevated',
  'stale_penalty_elevated',
  'category_penalty_elevated',
  'source_disagreement_penalty_elevated',
  'sell_source_requires_listed_exit',
  'steam_snapshot_fallback_used',
  'steam_snapshot_pair_demoted',
  'stale_snapshot_used',
  'backup_reference_confirms_band',
  'backup_reference_outlier',
  'strict_variant_key_missing',
  'strict_variant_key_mismatch',
  'pre_score_outlier_rejected',
  'source_median_outlier_rejected',
  'cross_source_consensus_outlier_rejected',
  'insufficient_comparable_sources',
  'stale_pre_score_rejection',
  'MISMATCH_EXTERIOR',
  'MISMATCH_STATTRAK',
  'MISMATCH_SOUVENIR',
  'MISMATCH_PHASE',
  'LOW_MATCH_CONFIDENCE',
  'UNKNOWN_FLOAT_PREMIUM',
  'UNKNOWN_STICKER_PREMIUM',
  'UNKNOWN_PATTERN_PREMIUM',
  'UNKNOWN_PHASE_PREMIUM',
  'STALE_SOURCE_STATE',
  'LOW_SOURCE_CONFIDENCE',
  'OUTLIER_PRICE',
  'INSUFFICIENT_LIQUIDITY',
  'FROZEN_MARKET',
  'NO_CONFIRMING_SOURCE',
  'scheme_category_not_allowed',
  'scheme_variant_not_allowed',
  'scheme_buy_source_not_allowed',
  'scheme_sell_source_not_allowed',
  'scheme_source_pair_excluded',
  'scheme_profit_below_floor',
  'scheme_confidence_below_floor',
  'scheme_liquidity_below_floor',
  'scheme_buy_cost_out_of_range',
  'scheme_disposition_below_floor',
  'scheme_risk_above_ceiling',
  'scheme_fallback_blocked',
  'scheme_listed_exit_blocked',
  'scheme_risky_high_upside_blocked',
] as const;

export type OpportunityReasonCode = (typeof OPPORTUNITY_REASON_CODES)[number];

export const OPPORTUNITY_ENGINE_RISK_CLASSES = [
  'low',
  'medium',
  'high',
  'extreme',
] as const;

export type OpportunityEngineRiskClass =
  (typeof OPPORTUNITY_ENGINE_RISK_CLASSES)[number];

export const OPPORTUNITY_SURFACE_TIERS = [
  'tradable',
  'reference_backed',
  'near_eligible',
  'research',
  'rejected',
] as const;

export type OpportunitySurfaceTier = (typeof OPPORTUNITY_SURFACE_TIERS)[number];

export const OPPORTUNITY_BLOCKER_REASONS = [
  'steam_snapshot_pair',
  'listed_exit_only',
  'fallback_data',
  'low_expected_net',
  'low_spread_percent',
  'low_confidence',
  'low_liquidity',
  'strict_variant_key_missing',
  'strict_variant_key_mismatch',
  'pre_score_outlier',
  'insufficient_comparables',
  'stale_sources',
] as const;

export type OpportunityBlockerReason =
  (typeof OPPORTUNITY_BLOCKER_REASONS)[number];

export const OPPORTUNITY_RISK_REASON_SEVERITIES = [
  'info',
  'warning',
  'critical',
] as const;

export type OpportunityRiskReasonSeverity =
  (typeof OPPORTUNITY_RISK_REASON_SEVERITIES)[number];

export const OPPORTUNITY_RISK_REASON_CODES = [
  'steam_snapshot_pair',
  'reference_backed_only',
  'listed_exit_only',
  'fallback_data',
  'stale_sources',
  'low_liquidity',
  'cross_source_disagreement',
  'strict_variant_key_missing',
  'strict_variant_key_mismatch',
  'pattern_or_float_uncertainty',
  'price_outlier',
  'insufficient_comparables',
  'low_confidence',
] as const;

export type OpportunityRiskReasonCode =
  (typeof OPPORTUNITY_RISK_REASON_CODES)[number];
