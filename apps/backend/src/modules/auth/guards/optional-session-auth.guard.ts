import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';

import type { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';
import { AuthSessionService } from '../services/auth-session.service';

@Injectable()
export class OptionalSessionAuthGuard implements CanActivate {
  constructor(
    @Inject(AuthSessionService)
    protected readonly authSessionService: AuthSessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const auth = await this.authSessionService.authenticateRequest(request);

    if (auth) {
      request.auth = auth;
    } else {
      delete request.auth;
    }

    return true;
  }
}
