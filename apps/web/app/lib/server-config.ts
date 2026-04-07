import 'server-only';

import { API_BASE_URL } from './config';

function readServerEnv(key: 'SESSION_COOKIE_NAME', fallback: string): string {
  const value = process.env[key]?.trim();

  if (value) {
    return value;
  }

  if (process.env.NODE_ENV !== 'production') {
    return fallback;
  }

  throw new Error(`Missing required environment variable ${key}.`);
}

export { API_BASE_URL };

export const SESSION_COOKIE_NAME = readServerEnv(
  'SESSION_COOKIE_NAME',
  'skinalpha_session',
);
