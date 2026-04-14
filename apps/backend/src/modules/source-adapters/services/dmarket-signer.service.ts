import {
  createPrivateKey,
  sign as signWithKey,
  type KeyObject,
} from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../infrastructure/config/app-config.service';

@Injectable()
export class DMarketSignerService {
  private signingKey?: KeyObject;

  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
  ) {}

  buildSignedHeaders(input: {
    readonly method: string;
    readonly pathWithQuery: string;
    readonly body?: string;
    readonly timestampSeconds?: number;
  }): Record<string, string> {
    const timestampSeconds =
      input.timestampSeconds ?? Math.floor(Date.now() / 1000);
    const stringToSign = `${input.method.toUpperCase()}${input.pathWithQuery}${input.body ?? ''}${timestampSeconds}`;
    const signature = signWithKey(
      null,
      Buffer.from(stringToSign, 'utf8'),
      this.getSigningKey(),
    ).toString('hex');

    return {
      'X-Api-Key': this.configService.dmarketPublicKey!,
      'X-Sign-Date': String(timestampSeconds),
      'X-Request-Sign': `dmar ed25519 ${signature}`,
    };
  }

  private getSigningKey(): KeyObject {
    if (this.signingKey) {
      return this.signingKey;
    }

    if (!this.configService.dmarketPublicKey || !this.configService.dmarketSecretKey) {
      throw new Error('DMarket signing keys are not configured.');
    }

    const publicKey = this.hexToBuffer(this.configService.dmarketPublicKey);
    const secretKey = this.hexToBuffer(this.configService.dmarketSecretKey);
    const privateSeed =
      secretKey.length >= 32 ? secretKey.subarray(0, 32) : secretKey;

    if (publicKey.length !== 32) {
      throw new Error('DMARKET_PUBLIC_KEY must be a 32-byte hex string.');
    }

    if (privateSeed.length !== 32) {
      throw new Error(
        'DMARKET_SECRET_KEY must contain at least a 32-byte Ed25519 private seed.',
      );
    }

    this.signingKey = createPrivateKey({
      key: {
        crv: 'Ed25519',
        d: privateSeed.toString('base64url'),
        kty: 'OKP',
        x: publicKey.toString('base64url'),
      },
      format: 'jwk',
    });

    return this.signingKey;
  }

  private hexToBuffer(value: string): Buffer {
    const normalized = value.trim().toLowerCase();

    if (normalized.length === 0 || normalized.length % 2 !== 0) {
      throw new Error('Expected a non-empty even-length hex string.');
    }

    return Buffer.from(normalized, 'hex');
  }
}
