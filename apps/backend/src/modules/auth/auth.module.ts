import { Module } from '@nestjs/common';

import { AuthController } from './controllers/auth.controller';
import { AUTH_NOTIFICATION_SERVICE } from './domain/auth-notification.port';
import { AUTH_REPOSITORY } from './domain/auth.repository';
import { OptionalSessionAuthGuard } from './guards/optional-session-auth.guard';
import { SessionAuthGuard } from './guards/session-auth.guard';
import { AuthRepositoryAdapter } from './infrastructure/auth.repository';
import { AuthStateService } from './infrastructure/auth-state.service';
import { GoogleOidcService } from './infrastructure/google-oidc.service';
import { SteamOpenIdService } from './infrastructure/steam-openid.service';
import { AuthService } from './services/auth.service';
import { AuthSessionService } from './services/auth-session.service';
import { NoopAuthNotificationService } from './services/noop-auth-notification.service';
import { PasswordHasherService } from './services/password-hasher.service';
import { SessionCookieService } from './services/session-cookie.service';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthSessionService,
    AuthStateService,
    GoogleOidcService,
    SteamOpenIdService,
    PasswordHasherService,
    SessionCookieService,
    SessionAuthGuard,
    OptionalSessionAuthGuard,
    {
      provide: AUTH_REPOSITORY,
      useClass: AuthRepositoryAdapter,
    },
    {
      provide: AUTH_NOTIFICATION_SERVICE,
      useClass: NoopAuthNotificationService,
    },
  ],
  exports: [AuthSessionService, SessionAuthGuard, OptionalSessionAuthGuard],
})
export class AuthModule {}
