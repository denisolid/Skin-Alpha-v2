import type { IdentityProvider, UserRole, UserStatus } from '@prisma/client';

import type { AuthUserRecord } from '../domain/auth.repository';

export class CurrentUserIdentityDto {
  readonly id: string;
  readonly provider: IdentityProvider;
  readonly email: string | null;
  readonly createdAt: Date;
  readonly lastAuthenticatedAt: Date | null;

  constructor(identity: AuthUserRecord['identities'][number]) {
    this.id = identity.id;
    this.provider = identity.provider;
    this.email = identity.email;
    this.createdAt = identity.createdAt;
    this.lastAuthenticatedAt = identity.lastAuthenticatedAt;
  }
}

export class CurrentUserDto {
  readonly id: string;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly emailVerifiedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly identities: CurrentUserIdentityDto[];

  constructor(user: AuthUserRecord) {
    this.id = user.id;
    this.email = user.email;
    this.displayName = user.displayName;
    this.role = user.role;
    this.status = user.status;
    this.emailVerifiedAt = user.emailVerifiedAt;
    this.createdAt = user.createdAt;
    this.updatedAt = user.updatedAt;
    this.identities = user.identities.map(
      (identity) => new CurrentUserIdentityDto(identity),
    );
  }
}
