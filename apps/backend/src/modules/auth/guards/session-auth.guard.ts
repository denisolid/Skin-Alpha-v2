import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import type { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';
import { AuthSessionService } from '../services/auth-session.service';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    @Inject(AuthSessionService)
    private readonly authSessionService: AuthSessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const auth = await this.authSessionService.authenticateRequest(request);

    if (!auth) {
      throw new UnauthorizedException('Authentication required.');
    }

    request.auth = auth;

    return true;
  }
}
