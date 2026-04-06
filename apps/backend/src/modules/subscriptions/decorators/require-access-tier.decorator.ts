import { SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';

import { SessionAuthGuard } from '../../auth/guards/session-auth.guard';
import {
  REQUIRED_ACCESS_TIER_METADATA_KEY,
  type AccessTier,
} from '../domain/subscription-access.model';
import { AccessTierGuard } from '../guards/access-tier.guard';

export function RequireAccessTier(accessTier: AccessTier) {
  return applyDecorators(
    SetMetadata(REQUIRED_ACCESS_TIER_METADATA_KEY, accessTier),
    UseGuards(SessionAuthGuard, AccessTierGuard),
  );
}
