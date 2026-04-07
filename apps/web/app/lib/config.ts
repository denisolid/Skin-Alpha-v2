const NEXT_PUBLIC_APP_NAME = process.env.NEXT_PUBLIC_APP_NAME?.trim();
const NEXT_PUBLIC_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();

function readOptionalPublicEnv(value: string | undefined, fallback: string): string {
  if (value) {
    return value;
  }

  return fallback;
}

function readRequiredPublicEnv(
  key: 'NEXT_PUBLIC_API_BASE_URL',
  value: string | undefined,
  fallback: string,
): string {

  if (value) {
    return value;
  }

  if (process.env.NODE_ENV !== 'production') {
    return fallback;
  }

  throw new Error(`Missing required environment variable ${key}.`);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export const APP_NAME = readOptionalPublicEnv(
  NEXT_PUBLIC_APP_NAME,
  'SkinAlpha v2',
);

export const API_BASE_URL = trimTrailingSlash(
  readRequiredPublicEnv(
    'NEXT_PUBLIC_API_BASE_URL',
    NEXT_PUBLIC_API_BASE_URL,
    'http://localhost:3001/api',
  ),
);
