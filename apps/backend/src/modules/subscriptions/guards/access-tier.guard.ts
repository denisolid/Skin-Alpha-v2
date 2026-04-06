import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthenticatedRequest } from '../../auth/interfaces/authenticated-request.interface';
import {
  REQUIRED_ACCESS_TIER_METADATA_KEY,
  canAccessTier,
  type AccessTier,
} from '../domain/subscription-access.model';
import { AccessControlService } from '../services/access-control.service';

@Injectable()
export class AccessTierGuard implements CanActivate {
  constructor(
    @Inject(Reflector)
    private readonly reflector: Reflector,
    @Inject(AccessControlService)
    private readonly accessControlService: AccessControlService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredAccessTier = this.reflector.getAllAndOverride<
      AccessTier | undefined
    >(REQUIRED_ACCESS_TIER_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredAccessTier) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.auth) {
      throw new UnauthorizedException('Authentication required.');
    }

    const accessContext = await this.accessControlService.resolveAccessContext(
      request.auth.user.id,
    );

    request.access = accessContext;

    if (!canAccessTier(accessContext.accessTier, requiredAccessTier)) {
      throw new ForbiddenException(
        `Access tier '${requiredAccessTier}' is required for this endpoint.`,
      );
    }

    return true;
  }
}
