import { Inject, Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../infrastructure/config/app-config.service';
import type { SteamSnapshotBatchPlanDto } from '../dto/steam-snapshot.dto';
import { OverlapAwareSourceUniverseService } from './overlap-aware-source-universe.service';

interface SelectPriorityBatchesInput {
  readonly batchBudget?: number;
  readonly targetItemVariantIds?: readonly string[];
  readonly force?: boolean;
}

@Injectable()
export class SteamSnapshotUniverseService {
  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
    @Inject(OverlapAwareSourceUniverseService)
    private readonly overlapAwareSourceUniverseService: OverlapAwareSourceUniverseService,
  ) {}

  async selectPriorityBatches(
    input: SelectPriorityBatchesInput = {},
  ): Promise<readonly SteamSnapshotBatchPlanDto[]> {
    const batchBudget = Math.max(
      1,
      input.batchBudget ?? this.configService.steamSnapshotBatchBudget,
    );
    const batchSize = Math.max(1, this.configService.steamSnapshotBatchSize);
    const batches =
      await this.overlapAwareSourceUniverseService.selectPriorityBatches({
        source: 'steam-snapshot',
        batchBudget,
        batchSize,
        staleAfterMs: this.configService.steamSnapshotStaleAfterMs,
        ...(input.targetItemVariantIds?.length
          ? {
              targetItemVariantIds: input.targetItemVariantIds,
            }
          : {}),
        ...(input.force ? { force: true } : {}),
      });

    return batches.map((batch) => ({
      batchId: batch.batchId,
      targets: batch.targets.map((target) => ({
        canonicalItemId: target.canonicalItemId,
        itemVariantId: target.itemVariantId,
        marketHashName: target.marketHashName,
        priorityScore: target.priorityScore,
        priorityReason: target.priorityReason,
      })),
    }));
  }
}
