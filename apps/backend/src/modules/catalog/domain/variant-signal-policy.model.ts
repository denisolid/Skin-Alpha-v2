export const VARIANT_SIGNAL_SENSITIVITIES = [
  'none',
  'supported',
  'required',
] as const;

export type VariantSignalSensitivity =
  (typeof VARIANT_SIGNAL_SENSITIVITIES)[number];

export interface VariantSignalPolicyModel {
  readonly patternRelevant: boolean;
  readonly floatRelevant: boolean;
  readonly patternSensitivity: VariantSignalSensitivity;
  readonly floatSensitivity: VariantSignalSensitivity;
  readonly warnings: readonly string[];
}
