export type RawSearchParams =
  | Record<string, string | string[] | undefined>
  | URLSearchParams;

export function readSearchParam(
  params: RawSearchParams,
  key: string,
): string | undefined {
  const value =
    params instanceof URLSearchParams ? params.get(key) : params[key];

  if (Array.isArray(value)) {
    return value[0];
  }

  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function readNumberSearchParam(
  params: RawSearchParams,
  key: string,
): number | undefined {
  const value = readSearchParam(params, key);

  if (!value) {
    return undefined;
  }

  const numericValue = Number(value);

  return Number.isFinite(numericValue) ? numericValue : undefined;
}
