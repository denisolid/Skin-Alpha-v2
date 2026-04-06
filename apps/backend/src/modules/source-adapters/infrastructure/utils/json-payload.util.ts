import { createHash } from 'node:crypto';

import type { Prisma } from '@prisma/client';

interface CanonicalJsonPayload {
  readonly hash: string;
  readonly serialized: string;
  readonly value: Prisma.InputJsonValue;
}

export function canonicalizeJsonPayload(
  payload: unknown,
): CanonicalJsonPayload {
  const serialized = stableJsonStringify(payload);

  return {
    hash: createHash('sha256').update(serialized).digest('hex'),
    serialized,
    value: JSON.parse(serialized) as Prisma.InputJsonValue,
  };
}

function stableJsonStringify(payload: unknown): string {
  if (payload === null || typeof payload !== 'object') {
    return JSON.stringify(payload);
  }

  if (Array.isArray(payload)) {
    return `[${payload.map((entry) => stableJsonStringify(entry)).join(',')}]`;
  }

  const entries = Object.entries(payload as Record<string, unknown>).sort(
    ([leftKey], [rightKey]) => leftKey.localeCompare(rightKey),
  );

  return `{${entries
    .map(
      ([key, value]) => `${JSON.stringify(key)}:${stableJsonStringify(value)}`,
    )
    .join(',')}}`;
}
