export const APP_NAME =
  process.env.NEXT_PUBLIC_APP_NAME?.trim() || 'SkinAlpha v2';

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || 'http://localhost:3001/api';

export const SESSION_COOKIE_NAME =
  process.env.SESSION_COOKIE_NAME?.trim() || 'skinalpha_session';
