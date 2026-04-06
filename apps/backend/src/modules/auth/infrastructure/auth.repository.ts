import {
  IdentityProvider,
  Prisma,
  SessionStatus,
  SubscriptionPlan,
  SubscriptionProvider,
  SubscriptionStatus,
} from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  AuthIdentityRecord,
  AuthRepository,
  AuthSessionRecord,
  AuthUserRecord,
  CreateSessionInput,
  CreateUserWithIdentityInput,
  RotateSessionInput,
  UpdateIdentityAuthenticationInput,
  UpdateUserEmailIfAvailableInput,
} from '../domain/auth.repository';

const authUserInclude = Prisma.validator<Prisma.UserInclude>()({
  identities: {
    orderBy: {
      createdAt: 'asc',
    },
  },
});

const authIdentityInclude = Prisma.validator<Prisma.IdentityInclude>()({
  user: {
    include: authUserInclude,
  },
});

const authSessionInclude = Prisma.validator<Prisma.SessionInclude>()({
  identity: true,
  user: {
    include: authUserInclude,
  },
});

@Injectable()
export class AuthRepositoryAdapter implements AuthRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findUserByEmail(email: string): Promise<AuthUserRecord | null> {
    return this.prisma.user.findUnique({
      where: { email },
      include: authUserInclude,
    });
  }

  findUserById(userId: string): Promise<AuthUserRecord | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: authUserInclude,
    });
  }

  findEmailIdentityByEmail(email: string): Promise<AuthIdentityRecord | null> {
    return this.prisma.identity.findUnique({
      where: {
        provider_providerUserId: {
          provider: IdentityProvider.EMAIL,
          providerUserId: email,
        },
      },
      include: authIdentityInclude,
    });
  }

  findIdentityByProviderUserId(
    provider: IdentityProvider,
    providerUserId: string,
  ): Promise<AuthIdentityRecord | null> {
    return this.prisma.identity.findUnique({
      where: {
        provider_providerUserId: {
          provider,
          providerUserId,
        },
      },
      include: authIdentityInclude,
    });
  }

  async createUserWithIdentity(
    input: CreateUserWithIdentityInput,
  ): Promise<{ identityId: string; user: AuthUserRecord }> {
    const identityCreateInput: Prisma.IdentityCreateWithoutUserInput = {
      provider: input.identity.provider,
      providerUserId: input.identity.providerUserId,
      email: input.identity.email ?? null,
      passwordHash: input.identity.passwordHash ?? null,
      lastAuthenticatedAt: input.identity.lastAuthenticatedAt ?? null,
      ...(input.identity.profile !== undefined &&
      input.identity.profile !== null
        ? { profile: input.identity.profile }
        : {}),
    };
    const user = await this.prisma.user.create({
      data: {
        email: input.email ?? null,
        emailVerifiedAt: input.emailVerifiedAt ?? null,
        displayName: input.displayName ?? null,
        subscriptions: {
          create: {
            provider: SubscriptionProvider.MANUAL,
            plan: SubscriptionPlan.FREE,
            status: SubscriptionStatus.ACTIVE,
            currentPeriodStart: new Date(),
            metadata: {
              source: 'default-free-access',
            },
          },
        },
        identities: {
          create: identityCreateInput,
        },
      },
      include: authUserInclude,
    });

    const identity = user.identities.find(
      (candidate) =>
        candidate.provider === input.identity.provider &&
        candidate.providerUserId === input.identity.providerUserId,
    );

    if (!identity) {
      throw new Error('Identity creation failed.');
    }

    return {
      user,
      identityId: identity.id,
    };
  }

  linkIdentityToUser(input: {
    userId: string;
    identity: CreateUserWithIdentityInput['identity'];
  }): Promise<AuthIdentityRecord> {
    const createData: Prisma.IdentityUncheckedCreateInput = {
      userId: input.userId,
      provider: input.identity.provider,
      providerUserId: input.identity.providerUserId,
      email: input.identity.email ?? null,
      passwordHash: input.identity.passwordHash ?? null,
      lastAuthenticatedAt: input.identity.lastAuthenticatedAt ?? null,
      ...(input.identity.profile !== undefined &&
      input.identity.profile !== null
        ? { profile: input.identity.profile }
        : {}),
    };

    return this.prisma.identity.create({
      data: {
        ...createData,
      },
      include: authIdentityInclude,
    });
  }

  async updateIdentityAuthentication(
    input: UpdateIdentityAuthenticationInput,
  ): Promise<void> {
    const updateData: Prisma.IdentityUpdateInput = {
      lastAuthenticatedAt: input.lastAuthenticatedAt,
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.profile !== undefined && input.profile !== null
        ? { profile: input.profile }
        : {}),
    };

    await this.prisma.identity.update({
      where: { id: input.identityId },
      data: updateData,
    });
  }

  createSession(input: CreateSessionInput): Promise<AuthSessionRecord> {
    return this.prisma.session.create({
      data: {
        userId: input.userId,
        identityId: input.identityId ?? null,
        sessionTokenHash: input.sessionTokenHash,
        status: SessionStatus.ACTIVE,
        expiresAt: input.expiresAt,
        lastUsedAt: input.lastUsedAt ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
      include: authSessionInclude,
    });
  }

  findSessionByTokenHash(
    sessionTokenHash: string,
  ): Promise<AuthSessionRecord | null> {
    return this.prisma.session.findUnique({
      where: { sessionTokenHash },
      include: authSessionInclude,
    });
  }

  rotateSession(input: RotateSessionInput): Promise<AuthSessionRecord> {
    const updateData: Prisma.SessionUpdateInput = {
      sessionTokenHash: input.sessionTokenHash,
      expiresAt: input.expiresAt,
      lastUsedAt: input.lastUsedAt,
      invalidatedAt: null,
      status: SessionStatus.ACTIVE,
      ...(input.ipAddress !== undefined ? { ipAddress: input.ipAddress } : {}),
      ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
    };

    return this.prisma.session.update({
      where: { id: input.sessionId },
      data: updateData,
      include: authSessionInclude,
    });
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        status: SessionStatus.REVOKED,
        invalidatedAt: new Date(),
      },
    });
  }

  async markSessionExpired(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: {
        id: sessionId,
        status: SessionStatus.ACTIVE,
      },
      data: {
        status: SessionStatus.EXPIRED,
        invalidatedAt: new Date(),
      },
    });
  }

  async updateUserLastSeen(userId: string, lastSeenAt: Date): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastSeenAt },
    });
  }

  async updateUserEmailIfAvailable(
    input: UpdateUserEmailIfAvailableInput,
  ): Promise<AuthUserRecord | null> {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });

    if (existingUser && existingUser.id !== input.userId) {
      return null;
    }

    return this.prisma.user.update({
      where: { id: input.userId },
      data: {
        email: input.email,
        ...(input.emailVerifiedAt
          ? { emailVerifiedAt: input.emailVerifiedAt }
          : {}),
      },
      include: authUserInclude,
    });
  }
}
