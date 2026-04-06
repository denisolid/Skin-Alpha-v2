import { IdentityProvider, UserStatus } from '@prisma/client';
import {
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

import { AppConfigService } from '../../../infrastructure/config/app-config.service';
import { AppLoggerService } from '../../../infrastructure/logging/app-logger.service';
import type { AuthUseCase } from '../application/auth.use-case';
import {
  AUTH_NOTIFICATION_SERVICE,
  type AuthNotificationService,
} from '../domain/auth-notification.port';
import {
  AUTH_REPOSITORY,
  type AuthRepository,
  type AuthUserRecord,
} from '../domain/auth.repository';
import type {
  AuthRequestMetadata,
  AuthSessionContext,
  ExternalAuthIntent,
  ExternalAuthProfile,
  ExternalAuthProvider,
  StoredAuthState,
} from '../domain/auth.types';
import { ExternalAuthFlowError } from '../domain/auth.types';
import {
  AuthSessionResponseDto,
  CurrentUserDto,
  type EmailLoginDto,
  type EmailRegisterDto,
  ExternalAuthUrlDto,
  type GoogleCallbackQueryDto,
} from '../dto';
import { AuthStateService } from '../infrastructure/auth-state.service';
import { GoogleOidcService } from '../infrastructure/google-oidc.service';
import { SteamOpenIdService } from '../infrastructure/steam-openid.service';
import { AuthSessionService } from './auth-session.service';
import { PasswordHasherService } from './password-hasher.service';

@Injectable()
export class AuthService implements AuthUseCase {
  constructor(
    @Inject(AUTH_REPOSITORY)
    private readonly authRepository: AuthRepository,
    @Inject(AUTH_NOTIFICATION_SERVICE)
    private readonly authNotificationService: AuthNotificationService,
    @Inject(AuthSessionService)
    private readonly authSessionService: AuthSessionService,
    @Inject(AuthStateService)
    private readonly authStateService: AuthStateService,
    @Inject(PasswordHasherService)
    private readonly passwordHasherService: PasswordHasherService,
    @Inject(GoogleOidcService)
    private readonly googleOidcService: GoogleOidcService,
    @Inject(SteamOpenIdService)
    private readonly steamOpenIdService: SteamOpenIdService,
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
    @Inject(AppLoggerService)
    private readonly logger: AppLoggerService,
  ) {}

  async register(
    input: EmailRegisterDto,
    requestMetadata: AuthRequestMetadata,
  ): Promise<{
    response: AuthSessionResponseDto;
    sessionToken: string;
  }> {
    const email = this.normalizeEmail(input.email);
    const existingEmailIdentity =
      await this.authRepository.findEmailIdentityByEmail(email);

    if (existingEmailIdentity) {
      throw new ConflictException('An account with that email already exists.');
    }

    const existingUser = await this.authRepository.findUserByEmail(email);

    if (existingUser) {
      throw new ConflictException('An account with that email already exists.');
    }

    const passwordHash = await this.passwordHasherService.hash(input.password);
    const { identityId, user } =
      await this.authRepository.createUserWithIdentity({
        email,
        displayName: this.normalizeOptionalString(input.displayName),
        identity: {
          provider: IdentityProvider.EMAIL,
          providerUserId: email,
          email,
          passwordHash,
          lastAuthenticatedAt: new Date(),
          profile: {
            registrationMethod: 'email-password',
          },
        },
      });
    const sessionResult = await this.authSessionService.createSession(
      user.id,
      identityId,
      requestMetadata,
    );

    await this.authNotificationService.onEmailRegistered({
      userId: user.id,
      email,
    });

    return {
      response: new AuthSessionResponseDto(sessionResult.session),
      sessionToken: sessionResult.sessionToken,
    };
  }

  async login(
    input: EmailLoginDto,
    requestMetadata: AuthRequestMetadata,
  ): Promise<{
    response: AuthSessionResponseDto;
    sessionToken: string;
  }> {
    const email = this.normalizeEmail(input.email);
    const emailIdentity =
      await this.authRepository.findEmailIdentityByEmail(email);

    if (!emailIdentity?.passwordHash) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    this.assertUserCanAuthenticate(emailIdentity.user);

    const passwordMatches = await this.passwordHasherService.verify(
      emailIdentity.passwordHash,
      input.password,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    await this.authRepository.updateIdentityAuthentication({
      identityId: emailIdentity.id,
      email,
      lastAuthenticatedAt: new Date(),
    });

    const sessionResult = await this.authSessionService.createSession(
      emailIdentity.user.id,
      emailIdentity.id,
      requestMetadata,
    );

    return {
      response: new AuthSessionResponseDto(sessionResult.session),
      sessionToken: sessionResult.sessionToken,
    };
  }

  async refresh(
    sessionContext: AuthSessionContext,
    requestMetadata: AuthRequestMetadata,
  ): Promise<{
    response: AuthSessionResponseDto;
    sessionToken: string;
  }> {
    this.assertUserCanAuthenticate(sessionContext.user);

    const sessionResult = await this.authSessionService.rotateSession(
      sessionContext,
      requestMetadata,
    );

    return {
      response: new AuthSessionResponseDto(sessionResult.session),
      sessionToken: sessionResult.sessionToken,
    };
  }

  logout(sessionContext: AuthSessionContext): Promise<void> {
    return this.authSessionService.revokeSession(sessionContext.session.id);
  }

  getCurrentUser(sessionContext: AuthSessionContext): CurrentUserDto {
    return new CurrentUserDto(sessionContext.user);
  }

  async getGoogleAuthorizationUrl(
    userId?: string,
  ): Promise<ExternalAuthUrlDto> {
    const googleRequest =
      await this.googleOidcService.createAuthorizationRequest('placeholder');
    const state = await this.authStateService.createState({
      provider: 'google',
      intent: userId ? 'link' : 'login',
      ...(userId ? { userId } : {}),
      codeVerifier: googleRequest.codeVerifier,
      nonce: googleRequest.nonce,
    });
    const authorizationUrl = new URL(googleRequest.authorizationUrl);

    authorizationUrl.searchParams.set('state', state);

    return new ExternalAuthUrlDto({
      provider: 'google',
      intent: userId ? 'link' : 'login',
      authorizationUrl: authorizationUrl.toString(),
    });
  }

  async getSteamAuthorizationUrl(userId?: string): Promise<ExternalAuthUrlDto> {
    const state = await this.authStateService.createState({
      provider: 'steam',
      intent: userId ? 'link' : 'login',
      ...(userId ? { userId } : {}),
    });

    return new ExternalAuthUrlDto({
      provider: 'steam',
      intent: userId ? 'link' : 'login',
      authorizationUrl: this.steamOpenIdService.createAuthorizationUrl(state),
    });
  }

  async handleGoogleCallback(
    query: GoogleCallbackQueryDto,
    requestMetadata: AuthRequestMetadata,
  ): Promise<{
    redirectUrl: string;
    response: AuthSessionResponseDto;
    sessionToken: string;
  }> {
    if (query.error) {
      throw new ExternalAuthFlowError(query.error);
    }

    const state = await this.authStateService.consumeState(
      'google',
      query.state,
    );

    if (!state?.codeVerifier || !state.nonce) {
      throw new ExternalAuthFlowError('google_invalid_state');
    }

    const profile = await this.googleOidcService.exchangeCodeForProfile({
      code: query.code,
      codeVerifier: state.codeVerifier,
      nonce: state.nonce,
    });

    return this.completeExternalAuthentication(
      'google',
      state,
      profile,
      requestMetadata,
    );
  }

  async handleSteamCallback(
    query: Record<string, unknown>,
    requestMetadata: AuthRequestMetadata,
  ): Promise<{
    redirectUrl: string;
    response: AuthSessionResponseDto;
    sessionToken: string;
  }> {
    const rawState = query.state;

    if (typeof rawState !== 'string' || rawState.length === 0) {
      throw new ExternalAuthFlowError('steam_invalid_state');
    }

    const state = await this.authStateService.consumeState('steam', rawState);

    if (!state) {
      throw new ExternalAuthFlowError('steam_invalid_state');
    }

    const profile = await this.steamOpenIdService.verifyCallback(query);

    return this.completeExternalAuthentication(
      'steam',
      state,
      profile,
      requestMetadata,
    );
  }

  buildExternalAuthErrorRedirect(
    provider: ExternalAuthProvider,
    error: unknown,
  ): string {
    const redirectUrl = new URL(this.configService.authExternalRedirectUrl);

    redirectUrl.searchParams.set('provider', provider);
    redirectUrl.searchParams.set('status', 'error');
    redirectUrl.searchParams.set('error', this.resolveExternalErrorCode(error));

    return redirectUrl.toString();
  }

  private async completeExternalAuthentication(
    provider: ExternalAuthProvider,
    state: StoredAuthState,
    profile: ExternalAuthProfile,
    requestMetadata: AuthRequestMetadata,
  ): Promise<{
    redirectUrl: string;
    response: AuthSessionResponseDto;
    sessionToken: string;
  }> {
    const completion = await this.resolveExternalIdentity(profile, state);
    const sessionResult = await this.authSessionService.createSession(
      completion.user.id,
      completion.identityId,
      requestMetadata,
    );

    return {
      redirectUrl: this.buildExternalAuthSuccessRedirect(
        provider,
        state.intent,
      ),
      response: new AuthSessionResponseDto(sessionResult.session),
      sessionToken: sessionResult.sessionToken,
    };
  }

  private async resolveExternalIdentity(
    profile: ExternalAuthProfile,
    state: StoredAuthState,
  ): Promise<{ identityId: string; user: AuthUserRecord }> {
    const existingIdentity =
      await this.authRepository.findIdentityByProviderUserId(
        profile.provider,
        profile.providerUserId,
      );

    if (state.intent === 'link') {
      return this.linkExternalIdentity(profile, state.userId, existingIdentity);
    }

    return this.loginWithExternalIdentity(profile, existingIdentity);
  }

  private async linkExternalIdentity(
    profile: ExternalAuthProfile,
    userId: string | undefined,
    existingIdentity: Awaited<
      ReturnType<AuthRepository['findIdentityByProviderUserId']>
    >,
  ): Promise<{ identityId: string; user: AuthUserRecord }> {
    if (!userId) {
      throw new ExternalAuthFlowError('link_requires_authenticated_user');
    }

    const currentUser = await this.authRepository.findUserById(userId);

    if (!currentUser) {
      throw new ExternalAuthFlowError('link_user_not_found');
    }

    this.assertUserCanAuthenticate(currentUser);

    const sameProviderIdentity = currentUser.identities.find(
      (identity) => identity.provider === profile.provider,
    );

    if (
      sameProviderIdentity &&
      sameProviderIdentity.providerUserId !== profile.providerUserId
    ) {
      throw new ExternalAuthFlowError('provider_already_linked');
    }

    if (existingIdentity && existingIdentity.user.id !== userId) {
      throw new ExternalAuthFlowError('identity_already_linked');
    }

    let identityId: string;

    if (existingIdentity) {
      identityId = existingIdentity.id;
      await this.authRepository.updateIdentityAuthentication({
        identityId,
        email: profile.email,
        lastAuthenticatedAt: new Date(),
        profile: profile.profile,
      });
    } else {
      const linkedIdentity = await this.authRepository.linkIdentityToUser({
        userId,
        identity: {
          provider: profile.provider,
          providerUserId: profile.providerUserId,
          email: profile.email,
          lastAuthenticatedAt: new Date(),
          profile: profile.profile,
        },
      });

      identityId = linkedIdentity.id;

      await this.authNotificationService.onIdentityLinked({
        userId,
        provider: profile.provider,
      });
    }

    const user = await this.maybeAssignUserEmail(currentUser, profile);

    return {
      user,
      identityId,
    };
  }

  private async loginWithExternalIdentity(
    profile: ExternalAuthProfile,
    existingIdentity: Awaited<
      ReturnType<AuthRepository['findIdentityByProviderUserId']>
    >,
  ): Promise<{ identityId: string; user: AuthUserRecord }> {
    if (existingIdentity) {
      this.assertUserCanAuthenticate(existingIdentity.user);

      await this.authRepository.updateIdentityAuthentication({
        identityId: existingIdentity.id,
        email: profile.email,
        lastAuthenticatedAt: new Date(),
        profile: profile.profile,
      });

      const user = await this.maybeAssignUserEmail(
        existingIdentity.user,
        profile,
      );

      return {
        user,
        identityId: existingIdentity.id,
      };
    }

    const normalizedEmail = profile.email
      ? this.normalizeEmail(profile.email)
      : null;
    const uniqueEmail =
      normalizedEmail &&
      !(await this.authRepository.findUserByEmail(normalizedEmail))
        ? normalizedEmail
        : null;
    const { identityId, user } =
      await this.authRepository.createUserWithIdentity({
        email: uniqueEmail,
        emailVerifiedAt:
          uniqueEmail && profile.emailVerified ? new Date() : null,
        displayName: this.normalizeOptionalString(profile.displayName),
        identity: {
          provider: profile.provider,
          providerUserId: profile.providerUserId,
          email: normalizedEmail,
          lastAuthenticatedAt: new Date(),
          profile: profile.profile,
        },
      });

    return {
      user,
      identityId,
    };
  }

  private async maybeAssignUserEmail(
    user: AuthUserRecord,
    profile: ExternalAuthProfile,
  ): Promise<AuthUserRecord> {
    if (user.email || !profile.email) {
      return user;
    }

    const updatedUser = await this.authRepository.updateUserEmailIfAvailable({
      userId: user.id,
      email: this.normalizeEmail(profile.email),
      emailVerifiedAt: profile.emailVerified ? new Date() : null,
    });

    return updatedUser ?? user;
  }

  private buildExternalAuthSuccessRedirect(
    provider: ExternalAuthProvider,
    intent: ExternalAuthIntent,
  ): string {
    const redirectUrl = new URL(this.configService.authExternalRedirectUrl);

    redirectUrl.searchParams.set('provider', provider);
    redirectUrl.searchParams.set('status', 'success');
    redirectUrl.searchParams.set('intent', intent);

    return redirectUrl.toString();
  }

  private resolveExternalErrorCode(error: unknown): string {
    if (error instanceof ExternalAuthFlowError) {
      return error.code;
    }

    if (error instanceof ConflictException) {
      return 'identity_already_linked';
    }

    if (error instanceof UnauthorizedException) {
      return 'unauthorized';
    }

    if (error instanceof ServiceUnavailableException) {
      return 'provider_unavailable';
    }

    this.logger.error(
      'Unhandled external auth error.',
      error instanceof Error ? error.stack : undefined,
      'AuthService',
    );

    return 'unexpected_error';
  }

  private assertUserCanAuthenticate(user: AuthUserRecord): void {
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('The account is not allowed to sign in.');
    }
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private normalizeOptionalString(
    value: string | null | undefined,
  ): string | null {
    const normalizedValue = value?.trim();

    return normalizedValue ? normalizedValue : null;
  }
}
