import type { IdentityProvider } from '@prisma/client';
import { Injectable } from '@nestjs/common';

import type { AuthNotificationService } from '../domain/auth-notification.port';

@Injectable()
export class NoopAuthNotificationService implements AuthNotificationService {
  async onEmailRegistered(_input: {
    email: string;
    userId: string;
  }): Promise<void> {}

  async onIdentityLinked(_input: {
    provider: IdentityProvider;
    userId: string;
  }): Promise<void> {}
}
