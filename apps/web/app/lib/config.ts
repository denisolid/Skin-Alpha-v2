function readPublicEnv(key: 'NEXT_PUBLIC_APP_NAME' | 'NEXT_PUBLIC_API_BASE_URL', fallback: string): string {
  const value = process.env[key]?.trim();

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

export const APP_NAME = readPublicEnv('NEXT_PUBLIC_APP_NAME', 'SkinAlpha v2');

export const API_BASE_URL = trimTrailingSlash(
  readPublicEnv('NEXT_PUBLIC_API_BASE_URL', 'http://localhost:3001/api'),
);
