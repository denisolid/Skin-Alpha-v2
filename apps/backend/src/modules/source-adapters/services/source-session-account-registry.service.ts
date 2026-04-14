import { Inject, Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../infrastructure/config/app-config.service';
import type { SourceAdapterKey } from '../domain/source-adapter.types';
import { SourceOperationalProfileService } from './source-operational-profile.service';

@Injectable()
export class SourceSessionAccountRegistryService {
  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
    @Inject(SourceOperationalProfileService)
    private readonly profileService: SourceOperationalProfileService,
  ) {}

  getReadiness(source: SourceAdapterKey): {
    readonly required: boolean;
    readonly available: boolean;
    readonly reason?: string;
  } {
    const profile = this.profileService.get(source);

    if (
      profile.sessionRequirement === 'none' &&
      profile.accountRequirement === 'none' &&
      profile.cookieRequirement === 'none'
    ) {
      return {
        required: false,
        available: true,
      };
    }

    if (source === 'c5game' && this.configService.isC5GameEnabled()) {
      return {
        required: true,
        available: true,
      };
    }

    return {
      required: true,
      available: false,
      reason: 'required_session_or_account_registry_not_configured',
    };
  }
}
