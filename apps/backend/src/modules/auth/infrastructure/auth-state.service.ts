import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../infrastructure/config/app-config.service';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import type {
  ExternalAuthProvider,
  StoredAuthState,
} from '../domain/auth.types';

@Injectable()
export class AuthStateService {
  constructor(
    @Inject(RedisService)
    private readonly redisService: RedisService,
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
  ) {}

  async createState(payload: StoredAuthState): Promise<string> {
    const state = randomBytes(24).toString('hex');

    await this.redisService
      .getClient()
      .set(
        this.buildKey(payload.provider, state),
        JSON.stringify(payload),
        'EX',
        this.configService.authStateTtlSeconds,
      );

    return state;
  }

  async consumeState(
    provider: ExternalAuthProvider,
    state: string,
  ): Promise<StoredAuthState | null> {
    const rawValue = await this.redisService
      .getClient()
      .getdel(this.buildKey(provider, state));

    if (!rawValue) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue) as Partial<StoredAuthState>;

    if (parsedValue.provider !== provider || !parsedValue.intent) {
      return null;
    }

    return {
      provider: parsedValue.provider,
      intent: parsedValue.intent,
      ...(parsedValue.userId ? { userId: parsedValue.userId } : {}),
      ...(parsedValue.codeVerifier
        ? { codeVerifier: parsedValue.codeVerifier }
        : {}),
      ...(parsedValue.nonce ? { nonce: parsedValue.nonce } : {}),
    };
  }

  private buildKey(provider: ExternalAuthProvider, state: string): string {
    return `auth:state:${provider}:${state}`;
  }
}
