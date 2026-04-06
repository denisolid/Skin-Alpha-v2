import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';

import { AppConfigService } from '../../../infrastructure/config/app-config.service';

@Injectable()
export class SessionCookieService {
  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
  ) {}

  extractSessionToken(request: Request): string | null {
    const cookieHeader = request.headers.cookie;

    if (!cookieHeader) {
      return null;
    }

    for (const rawCookie of cookieHeader.split(';')) {
      const [name, ...valueParts] = rawCookie.trim().split('=');

      if (name === this.configService.sessionCookieName) {
        return decodeURIComponent(valueParts.join('='));
      }
    }

    return null;
  }

  setSessionCookie(
    response: Response,
    sessionToken: string,
    expiresAt: Date,
  ): void {
    response.cookie(this.configService.sessionCookieName, sessionToken, {
      httpOnly: true,
      secure: this.configService.sessionSecureCookie,
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
  }

  clearSessionCookie(response: Response): void {
    response.clearCookie(this.configService.sessionCookieName, {
      httpOnly: true,
      secure: this.configService.sessionSecureCookie,
      sameSite: 'lax',
      path: '/',
    });
  }
}
