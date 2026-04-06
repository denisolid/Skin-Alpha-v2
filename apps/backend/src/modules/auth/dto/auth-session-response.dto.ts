import type { AuthSessionRecord } from '../domain/auth.repository';
import { CurrentUserDto } from './current-user.dto';

export class SessionSummaryDto {
  readonly id: string;
  readonly expiresAt: Date;
  readonly lastUsedAt: Date | null;
  readonly createdAt: Date;

  constructor(session: AuthSessionRecord) {
    this.id = session.id;
    this.expiresAt = session.expiresAt;
    this.lastUsedAt = session.lastUsedAt;
    this.createdAt = session.createdAt;
  }
}

export class AuthSessionResponseDto {
  readonly user: CurrentUserDto;
  readonly session: SessionSummaryDto;

  constructor(session: AuthSessionRecord) {
    this.user = new CurrentUserDto(session.user);
    this.session = new SessionSummaryDto(session);
  }
}
