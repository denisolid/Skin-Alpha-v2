import { createHash, randomBytes } from 'node:crypto';

import { SessionStatus } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import {
  AUTH_REPOSITORY,
  type AuthRepository,
} from '../domain/auth.repository';
import type {
  AuthRequestMetadata,
  AuthSessionContext,
  SessionTokenResult,
} from '../domain/auth.types';
import { SessionCookieService } from './session-cookie.service';
import type { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';
import { AppConfigService } from '../../../infrastructure/config/app-config.service';

@Injectable()
export class AuthSessionService {
  constructor(
    @Inject(AUTH_REPOSITORY)
    private readonly authRepository: AuthRepository,
    @Inject(SessionCookieService)
    private readonly sessionCookieService: SessionCookieService,
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
  ) {}

  async authenticateRequest(
    request: Request | AuthenticatedRequest,
  ): Promise<AuthSessionContext | null> {
    const sessionToken = this.sessionCookieService.extractSessionToken(request);

    if (!sessionToken) {
      return null;
    }

    const session = await this.authRepository.findSessionByTokenHash(
      this.hashSessionToken(sessionToken),
    );

    if (!session) {
      return null;
    }

    if (
      session.status !== SessionStatus.ACTIVE ||
      session.invalidatedAt ||
      session.expiresAt <= new Date()
    ) {
      if (
        session.status === SessionStatus.ACTIVE &&
        session.expiresAt <= new Date()
      ) {
        await this.authRepository.markSessionExpired(session.id);
      }

      return null;
    }

    return {
      session,
      user: session.user,
    };
  }

  async createSession(
    userId: string,
    identityId: string | null,
    requestMetadata: AuthRequestMetadata,
  ): Promise<SessionTokenResult> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.configService.sessionTtlMs);
    const sessionToken = randomBytes(48).toString('base64url');
    const session = await this.authRepository.createSession({
      userId,
      identityId,
      sessionTokenHash: this.hashSessionToken(sessionToken),
      expiresAt,
      lastUsedAt: now,
      ipAddress: requestMetadata.ipAddress,
      userAgent: requestMetadata.userAgent,
    });

    await this.authRepository.updateUserLastSeen(userId, now);

    return {
      session,
      sessionToken,
    };
  }

  async rotateSession(
    sessionContext: AuthSessionContext,
    requestMetadata: AuthRequestMetadata,
  ): Promise<SessionTokenResult> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.configService.sessionTtlMs);
    const sessionToken = randomBytes(48).toString('base64url');
    const session = await this.authRepository.rotateSession({
      sessionId: sessionContext.session.id,
      sessionTokenHash: this.hashSessionToken(sessionToken),
      expiresAt,
      lastUsedAt: now,
      ipAddress: requestMetadata.ipAddress,
      userAgent: requestMetadata.userAgent,
    });

    await this.authRepository.updateUserLastSeen(session.user.id, now);

    return {
      session,
      sessionToken,
    };
  }

  revokeSession(sessionId: string): Promise<void> {
    return this.authRepository.revokeSession(sessionId);
  }

  private hashSessionToken(sessionToken: string): string {
    return createHash('sha256').update(sessionToken).digest('hex');
  }
}
