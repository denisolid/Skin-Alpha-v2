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

interface SteamPlayerSummary {
  avatarfull?: string;
  personaname?: string;
  profileurl?: string;
}

@Injectable()
export class SteamOpenIdService {
  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
  ) {}

  createAuthorizationUrl(state: string): string {
    this.assertConfigured();

    const returnUrl = new URL(this.configService.steamOpenIdReturnUrl!);
    returnUrl.searchParams.set('state', state);

    const authorizationUrl = new URL(this.configService.steamOpenIdEndpoint);
    authorizationUrl.searchParams.set(
      'openid.ns',
      'http://specs.openid.net/auth/2.0',
    );
    authorizationUrl.searchParams.set('openid.mode', 'checkid_setup');
    authorizationUrl.searchParams.set(
      'openid.claimed_id',
      'http://specs.openid.net/auth/2.0/identifier_select',
    );
    authorizationUrl.searchParams.set(
      'openid.identity',
      'http://specs.openid.net/auth/2.0/identifier_select',
    );
    authorizationUrl.searchParams.set('openid.return_to', returnUrl.toString());
    authorizationUrl.searchParams.set(
      'openid.realm',
      this.configService.steamOpenIdRealm!,
    );

    return authorizationUrl.toString();
  }

  async verifyCallback(
    query: Record<string, unknown>,
  ): Promise<ExternalAuthProfile> {
    this.assertConfigured();

    const state = this.readRequiredQueryParam(query, 'state');
    const returnTo = this.readRequiredQueryParam(query, 'openid.return_to');
    const claimedId = this.readRequiredQueryParam(query, 'openid.claimed_id');
    const opEndpoint = this.readRequiredQueryParam(query, 'openid.op_endpoint');

    if (opEndpoint !== this.configService.steamOpenIdEndpoint) {
      throw new ExternalAuthFlowError('steam_invalid_endpoint');
    }

    this.assertReturnUrlMatches(returnTo, state);

    const verificationResponse = await fetch(
      this.configService.steamOpenIdEndpoint,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: this.buildVerificationBody(query),
      },
    );

    if (!verificationResponse.ok) {
      throw new ExternalAuthFlowError('steam_verification_failed');
    }

    const verificationBody = await verificationResponse.text();

    if (!verificationBody.includes('is_valid:true')) {
      throw new ExternalAuthFlowError('steam_invalid_assertion');
    }

    const steamIdMatch = claimedId.match(
      /^https:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/,
    );

    if (!steamIdMatch) {
      throw new ExternalAuthFlowError('steam_invalid_claimed_id');
    }

    const steamId = steamIdMatch[1];

    if (!steamId) {
      throw new ExternalAuthFlowError('steam_invalid_claimed_id');
    }

    const profileSummary = await this.fetchPlayerSummary(steamId);
    const profile = {
      avatarUrl: profileSummary?.avatarfull ?? null,
      claimedId,
      personaName: profileSummary?.personaname ?? null,
      profileUrl: profileSummary?.profileurl ?? null,
      steamId,
    } satisfies Prisma.InputJsonValue;

    return {
      provider: IdentityProvider.STEAM,
      providerUserId: steamId,
      email: null,
      emailVerified: false,
      displayName: profileSummary?.personaname ?? null,
      profile,
    };
  }

  private assertConfigured(): void {
    if (!this.configService.isSteamAuthConfigured()) {
      throw new ServiceUnavailableException(
        'Steam authentication is not configured.',
      );
    }
  }

  private buildVerificationBody(
    query: Record<string, unknown>,
  ): URLSearchParams {
    const searchParams = new URLSearchParams();

    for (const [key] of Object.entries(query)) {
      if (!key.startsWith('openid.')) {
        continue;
      }

      searchParams.set(key, this.readRequiredQueryParam(query, key));
    }

    searchParams.set('openid.mode', 'check_authentication');

    return searchParams;
  }

  private assertReturnUrlMatches(returnTo: string, state: string): void {
    const receivedUrl = new URL(returnTo);
    const configuredUrl = new URL(this.configService.steamOpenIdReturnUrl!);

    if (
      receivedUrl.origin !== configuredUrl.origin ||
      receivedUrl.pathname !== configuredUrl.pathname
    ) {
      throw new ExternalAuthFlowError('steam_return_url_mismatch');
    }

    if (receivedUrl.searchParams.get('state') !== state) {
      throw new ExternalAuthFlowError('steam_state_mismatch');
    }
  }

  private async fetchPlayerSummary(
    steamId: string,
  ): Promise<SteamPlayerSummary | null> {
    if (!this.configService.steamApiKey) {
      return null;
    }

    const summaryUrl = new URL(
      'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/',
    );

    summaryUrl.searchParams.set('key', this.configService.steamApiKey);
    summaryUrl.searchParams.set('steamids', steamId);

    const response = await fetch(summaryUrl);

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      response?: {
        players?: SteamPlayerSummary[];
      };
    };

    return payload.response?.players?.[0] ?? null;
  }

  private readRequiredQueryParam(
    query: Record<string, unknown>,
    key: string,
  ): string {
    const value = query[key];

    if (typeof value === 'string' && value.length > 0) {
      return value;
    }

    if (
      Array.isArray(value) &&
      typeof value[0] === 'string' &&
      value[0].length > 0
    ) {
      return value[0];
    }

    throw new ExternalAuthFlowError('steam_invalid_callback');
  }
}
