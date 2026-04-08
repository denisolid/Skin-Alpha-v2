import 'server-only';

function readServerEnv(
  key: 'SESSION_COOKIE_NAME' | 'SERVER_API_BASE_URL',
  fallback: string,
): string {
  const value = process.env[key]?.trim();

  if (value) {
    return value;
  }

  if (process.env.NODE_ENV !== 'production') {
    return fallback;
  }

  throw new Error(`Missing required environment variable ${key}.`);
}

export const SERVER_API_BASE_URL = readServerEnv(
  'SERVER_API_BASE_URL',
  'http://localhost:3001/api',
);

export const SESSION_COOKIE_NAME = readServerEnv(
  'SESSION_COOKIE_NAME',
  'skinalpha_session',
);
