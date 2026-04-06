import type { IdentityProvider } from '@prisma/client';

export const AUTH_NOTIFICATION_SERVICE = Symbol('AUTH_NOTIFICATION_SERVICE');

export interface AuthNotificationService {
  onEmailRegistered(input: { email: string; userId: string }): Promise<void>;
  onIdentityLinked(input: {
    provider: IdentityProvider;
    userId: string;
  }): Promise<void>;
}
