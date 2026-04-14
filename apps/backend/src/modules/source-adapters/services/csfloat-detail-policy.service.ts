import { Injectable } from '@nestjs/common';

import type { CsFloatListingDto } from '../dto/csfloat-listing-payload.dto';
import type { CsFloatListingDetailJobData } from '../dto/csfloat-sync.job.dto';

@Injectable()
export class CsFloatDetailPolicyService {
  determineReason(
    listing: CsFloatListingDto,
  ): CsFloatListingDetailJobData['reason'] | null {
    if (listing.item.floatValue === undefined) {
      return 'missing-float';
    }

    if (listing.item.paintSeed === undefined) {
      return 'missing-seed';
    }

    return null;
  }
}
