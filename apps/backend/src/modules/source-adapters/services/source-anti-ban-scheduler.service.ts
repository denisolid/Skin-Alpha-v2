import { Inject, Injectable } from '@nestjs/common';

import type { SourceAdapterKey } from '../domain/source-adapter.types';
import type { SourceRuntimeGuardMode } from '../domain/source-runtime-guard.model';
import { SourceOperationalProfileService } from './source-operational-profile.service';

@Injectable()
export class SourceAntiBanSchedulerService {
  constructor(
    @Inject(SourceOperationalProfileService)
    private readonly profileService: SourceOperationalProfileService,
  ) {}

  resolveInterval(input: {
    readonly source: SourceAdapterKey;
    readonly baseIntervalMs: number;
    readonly healthStatus: 'unknown' | 'healthy' | 'degraded' | 'down';
    readonly runtimeMode: SourceRuntimeGuardMode;
  }): number {
    const profile = this.profileService.get(input.source);
    const riskMultiplier =
      profile.riskTier === 'extreme'
        ? 2.2
        : profile.riskTier === 'high'
          ? 1.6
          : profile.riskTier === 'medium'
            ? 1.2
            : 1;
    const stageMultiplier =
      profile.stage === 'prep'
        ? 2
        : profile.stage === 'limited'
          ? 1.35
          : 1;
    const runtimeMultiplier =
      input.runtimeMode === 'disabled'
        ? 2.5
        : input.runtimeMode === 'cooldown'
          ? 2
          : input.runtimeMode === 'degraded'
            ? 1.35
            : 1;
    const healthMultiplier =
      input.healthStatus === 'down'
        ? 2
        : input.healthStatus === 'degraded'
          ? 1.35
          : 1;
    const jitterBucket =
      [...input.source].reduce((sum, character) => sum + character.charCodeAt(0), 0) %
      9;
    const jitterMultiplier = 1 + jitterBucket / 100;

    return Math.round(
      input.baseIntervalMs *
        riskMultiplier *
        stageMultiplier *
        runtimeMultiplier *
        healthMultiplier *
        jitterMultiplier,
    );
  }
}
