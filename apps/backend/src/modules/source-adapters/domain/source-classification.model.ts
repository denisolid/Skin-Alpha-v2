export const SOURCE_CLASSIFICATIONS = [
  'PRIMARY',
  'REFERENCE',
  'OPTIONAL',
  'FRAGILE',
] as const;

export type SourceClassification = (typeof SOURCE_CLASSIFICATIONS)[number];
