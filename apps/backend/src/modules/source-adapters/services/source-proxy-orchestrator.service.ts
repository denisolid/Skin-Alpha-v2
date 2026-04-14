import { Inject, Injectable } from '@nestjs/common';

import type { SourceAdapterKey } from '../domain/source-adapter.types';
import { SourceOperationalProfileService } from './source-operational-profile.service';

@Injectable()
export class SourceProxyOrchestratorService {
  constructor(
    @Inject(SourceOperationalProfileService)
    private readonly profileService: SourceOperationalProfileService,
  ) {}

  getReadiness(source: SourceAdapterKey): {
    readonly required: boolean;
    readonly available: boolean;
    readonly mode: 'direct' | 'proxy' | 'unavailable';
    readonly reason?: string;
  } {
    const profile = this.profileService.get(source);

    if (profile.proxyRequirement === 'none') {
      return {
        required: false,
        available: true,
        mode: 'direct',
      };
    }

    if (profile.proxyRequirement === 'optional') {
      return {
        required: false,
        available: true,
        mode: 'direct',
        reason: 'optional_proxy_not_configured',
      };
    }

    return {
      required: true,
      available: false,
      mode: 'unavailable',
      reason: 'required_proxy_pool_not_configured',
    };
  }
}
