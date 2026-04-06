import type { IdentityProvider, Prisma, SessionStatus } from '@prisma/client';

import type { AuthSessionRecord, AuthUserRecord } from './auth.repository';

export type ExternalAuthProvider = 'google' | 'steam';
export type ExternalAuthIntent = 'login' | 'link';

export interface AuthRequestMetadata {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AuthSessionContext {
  session: AuthSessionRecord;
  user: AuthUserRecord;
}

export interface ExternalAuthProfile {
  provider: IdentityProvider;
  providerUserId: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  profile: Prisma.InputJsonValue;
}

export interface StoredAuthState {
  provider: ExternalAuthProvider;
  intent: ExternalAuthIntent;
  userId?: string;
  codeVerifier?: string;
  nonce?: string;
}

export class ExternalAuthFlowError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export interface SessionTokenResult {
  session: AuthSessionRecord;
  sessionToken: string;
}

export function isActiveSessionStatus(status: SessionStatus): boolean {
  return status === 'ACTIVE';
}
