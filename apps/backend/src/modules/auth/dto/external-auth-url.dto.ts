import type {
  ExternalAuthIntent,
  ExternalAuthProvider,
} from '../domain/auth.types';

export class ExternalAuthUrlDto {
  readonly provider: ExternalAuthProvider;
  readonly intent: ExternalAuthIntent;
  readonly authorizationUrl: string;

  constructor(input: {
    authorizationUrl: string;
    intent: ExternalAuthIntent;
    provider: ExternalAuthProvider;
  }) {
    this.provider = input.provider;
    this.intent = input.intent;
    this.authorizationUrl = input.authorizationUrl;
  }
}
