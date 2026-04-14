import { Inject, Injectable } from '@nestjs/common';

import type { SourceAdapterKey } from '../domain/source-adapter.types';
import { SourceOperationalProfileService } from './source-operational-profile.service';

@Injectable()
export class SourceOverlapScoringService {
  constructor(
    @Inject(SourceOperationalProfileService)
    private readonly profileService: SourceOperationalProfileService,
  ) {}

  scoreExistingOverlap(existingSources: readonly SourceAdapterKey[]): {
    readonly score: number;
    readonly reason: string;
  } {
    const uniqueSources = [...new Set(existingSources)];

    if (uniqueSources.length === 0) {
      return {
        score: 0,
        reason: 'broad-hot-universe-bootstrap',
      };
    }

    const score = uniqueSources.reduce((total, source) => {
      const profile = this.profileService.get(source);

      return total + profile.overlapPriorityWeight * 100;
    }, 0);
    const pairBuildingScore = uniqueSources.reduce((total, source) => {
      const profile = this.profileService.get(source);

      return total + profile.pairBuildingWeight;
    }, 0);

    return {
      score: Number(
        (
          score +
          uniqueSources.length * 55 +
          (pairBuildingScore >= 2 ? 160 : pairBuildingScore >= 1 ? 60 : 0)
        ).toFixed(2),
      ),
      reason:
        pairBuildingScore >= 2
          ? 'high-quality-cross-market-overlap'
          : uniqueSources.length >= 2
            ? 'multi-source-overlap'
            : uniqueSources.includes('steam-snapshot')
              ? 'reference-seeded-followup'
              : 'single-source-bootstrap',
    };
  }
}
