import type { IdentityProvider, Prisma } from '@prisma/client';

export const AUTH_REPOSITORY = Symbol('AUTH_REPOSITORY');

export type AuthUserRecord = Prisma.UserGetPayload<{
  include: {
    identities: true;
  };
}>;

export type AuthIdentityRecord = Prisma.IdentityGetPayload<{
  include: {
    user: {
      include: {
        identities: true;
      };
    };
  };
}>;

export type AuthSessionRecord = Prisma.SessionGetPayload<{
  include: {
    identity: true;
    user: {
      include: {
        identities: true;
      };
    };
  };
}>;

export interface CreateIdentityInput {
  provider: IdentityProvider;
  providerUserId: string;
  email?: string | null;
  passwordHash?: string | null;
  profile?: Prisma.InputJsonValue | null;
  lastAuthenticatedAt?: Date | null;
}

export interface CreateUserWithIdentityInput {
  email?: string | null;
  emailVerifiedAt?: Date | null;
  displayName?: string | null;
  identity: CreateIdentityInput;
}

export interface CreateSessionInput {
  userId: string;
  identityId?: string | null;
  sessionTokenHash: string;
  expiresAt: Date;
  lastUsedAt?: Date | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface RotateSessionInput {
  sessionId: string;
  sessionTokenHash: string;
  expiresAt: Date;
  lastUsedAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface UpdateIdentityAuthenticationInput {
  identityId: string;
  email?: string | null;
  lastAuthenticatedAt: Date;
  profile?: Prisma.InputJsonValue | null;
}

export interface UpdateUserEmailIfAvailableInput {
  email: string;
  emailVerifiedAt?: Date | null;
  userId: string;
}

export interface AuthRepository {
  findUserByEmail(email: string): Promise<AuthUserRecord | null>;
  findUserById(userId: string): Promise<AuthUserRecord | null>;
  findEmailIdentityByEmail(email: string): Promise<AuthIdentityRecord | null>;
  findIdentityByProviderUserId(
    provider: IdentityProvider,
    providerUserId: string,
  ): Promise<AuthIdentityRecord | null>;
  createUserWithIdentity(input: CreateUserWithIdentityInput): Promise<{
    identityId: string;
    user: AuthUserRecord;
  }>;
  linkIdentityToUser(input: {
    userId: string;
    identity: CreateIdentityInput;
  }): Promise<AuthIdentityRecord>;
  updateIdentityAuthentication(
    input: UpdateIdentityAuthenticationInput,
  ): Promise<void>;
  createSession(input: CreateSessionInput): Promise<AuthSessionRecord>;
  findSessionByTokenHash(
    sessionTokenHash: string,
  ): Promise<AuthSessionRecord | null>;
  rotateSession(input: RotateSessionInput): Promise<AuthSessionRecord>;
  revokeSession(sessionId: string): Promise<void>;
  markSessionExpired(sessionId: string): Promise<void>;
  updateUserLastSeen(userId: string, lastSeenAt: Date): Promise<void>;
  updateUserEmailIfAvailable(
    input: UpdateUserEmailIfAvailableInput,
  ): Promise<AuthUserRecord | null>;
}
