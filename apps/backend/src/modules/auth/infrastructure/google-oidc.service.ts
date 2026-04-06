import { createHash, randomBytes } from 'node:crypto';

import { IdentityProvider, type Prisma } from '@prisma/client';
import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

import { AppConfigService } from '../../../infrastructure/config/app-config.service';
import {
  ExternalAuthFlowError,
  type ExternalAuthProfile,
} from '../domain/auth.types';

interface GoogleDiscoveryDocument {
  authorization_endpoint: string;
  issuer: string;
  jwks_uri: string;
  token_endpoint: string;
}

interface GoogleTokenResponse {
  id_token?: string;
}

@Injectable()
export class GoogleOidcService {
  private discoveryCache?:
    | {
        document: GoogleDiscoveryDocument;
        expiresAt: number;
      }
    | undefined;

  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
  ) {}

  async createAuthorizationRequest(state: string): Promise<{
    authorizationUrl: string;
    codeVerifier: string;
    nonce: string;
  }> {
    this.assertConfigured();

    const discoveryDocument = await this.getDiscoveryDocument();
    const codeVerifier = randomBytes(48).toString('base64url');
    const nonce = randomBytes(24).toString('hex');
    const authorizationUrl = new URL(discoveryDocument.authorization_endpoint);

    authorizationUrl.searchParams.set(
      'client_id',
      this.configService.googleClientId!,
    );
    authorizationUrl.searchParams.set(
      'redirect_uri',
      this.configService.googleRedirectUri!,
    );
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('scope', 'openid email profile');
    authorizationUrl.searchParams.set('state', state);
    authorizationUrl.searchParams.set('nonce', nonce);
    authorizationUrl.searchParams.set(
      'code_challenge',
      this.createCodeChallenge(codeVerifier),
    );
    authorizationUrl.searchParams.set('code_challenge_method', 'S256');
    authorizationUrl.searchParams.set('prompt', 'select_account');

    return {
      authorizationUrl: authorizationUrl.toString(),
      codeVerifier,
      nonce,
    };
  }

  async exchangeCodeForProfile(input: {
    code: string;
    codeVerifier: string;
    nonce: string;
  }): Promise<ExternalAuthProfile> {
    this.assertConfigured();

    const discoveryDocument = await this.getDiscoveryDocument();
    const tokenResponse = await fetch(discoveryDocument.token_endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.configService.googleClientId!,
        client_secret: this.configService.googleClientSecret!,
        redirect_uri: this.configService.googleRedirectUri!,
        code: input.code,
        code_verifier: input.codeVerifier,
      }),
    });

    if (!tokenResponse.ok) {
      throw new ExternalAuthFlowError('google_token_exchange_failed');
    }

    const tokenPayload = (await tokenResponse.json()) as GoogleTokenResponse;

    if (!tokenPayload.id_token) {
      throw new ExternalAuthFlowError('google_id_token_missing');
    }

    const jose = await import('jose');
    const { payload } = await jose.jwtVerify(
      tokenPayload.id_token,
      jose.createRemoteJWKSet(new URL(discoveryDocument.jwks_uri)),
      {
        issuer: discoveryDocument.issuer,
        audience: this.configService.googleClientId!,
      },
    );

    if (payload.nonce !== input.nonce) {
      throw new ExternalAuthFlowError('google_invalid_nonce');
    }

    const subject = this.readStringClaim(payload.sub, 'google_subject_missing');
    const email = this.readOptionalStringClaim(payload.email);
    const emailVerified = payload.email_verified === true;
    const displayName = this.readOptionalStringClaim(payload.name);
    const profile = {
      email,
      emailVerified,
      givenName: this.readOptionalStringClaim(payload.given_name),
      familyName: this.readOptionalStringClaim(payload.family_name),
      locale: this.readOptionalStringClaim(payload.locale),
      name: displayName,
      picture: this.readOptionalStringClaim(payload.picture),
      sub: subject,
    } satisfies Prisma.InputJsonValue;

    return {
      provider: IdentityProvider.GOOGLE,
      providerUserId: subject,
      email,
      emailVerified,
      displayName,
      profile,
    };
  }

  private assertConfigured(): void {
    if (!this.configService.isGoogleAuthConfigured()) {
      throw new ServiceUnavailableException(
        'Google authentication is not configured.',
      );
    }
  }

  private createCodeChallenge(codeVerifier: string): string {
    return createHash('sha256').update(codeVerifier).digest('base64url');
  }

  private async getDiscoveryDocument(): Promise<GoogleDiscoveryDocument> {
    if (this.discoveryCache && this.discoveryCache.expiresAt > Date.now()) {
      return this.discoveryCache.document;
    }

    const response = await fetch(this.configService.googleDiscoveryUrl);

    if (!response.ok) {
      throw new ExternalAuthFlowError('google_discovery_failed');
    }

    const document =
      (await response.json()) as Partial<GoogleDiscoveryDocument>;

    if (
      !document.authorization_endpoint ||
      !document.issuer ||
      !document.jwks_uri ||
      !document.token_endpoint
    ) {
      throw new ExternalAuthFlowError('google_discovery_invalid');
    }

    this.discoveryCache = {
      document: {
        authorization_endpoint: document.authorization_endpoint,
        issuer: document.issuer,
        jwks_uri: document.jwks_uri,
        token_endpoint: document.token_endpoint,
      },
      expiresAt: Date.now() + 60 * 60 * 1000,
    };

    return this.discoveryCache.document;
  }

  private readOptionalStringClaim(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private readStringClaim(value: unknown, errorCode: string): string {
    if (typeof value !== 'string' || value.length === 0) {
      throw new ExternalAuthFlowError(errorCode);
    }

    return value;
  }
}
