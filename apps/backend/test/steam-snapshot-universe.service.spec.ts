import type { AppConfigService } from '../src/infrastructure/config/app-config.service';
import type { OverlapAwareSourceUniverseService } from '../src/modules/source-adapters/services/overlap-aware-source-universe.service';
import { SteamSnapshotUniverseService } from '../src/modules/source-adapters/services/steam-snapshot-universe.service';

function createConfigServiceMock(): AppConfigService {
  return {
    steamSnapshotBatchBudget: 1,
    steamSnapshotBatchSize: 5,
    steamSnapshotStaleAfterMs: 2 * 60 * 60 * 1000,
  } as AppConfigService;
}

describe('SteamSnapshotUniverseService', () => {
  it('delegates steam target selection to the shared overlap-aware universe', async () => {
    const selectPriorityBatchesMock = jest.fn().mockResolvedValue([
      {
        batchId: 'steam-snapshot:1:demo',
        targets: [
          {
            canonicalItemId: 'canonical-1',
            itemVariantId: 'variant-1',
            marketHashName: 'AK-47 | Redline (Field-Tested)',
            priorityScore: 120,
            priorityReason: 'cross-market-overlap-anchor',
            existingSourceCount: 2,
            overlapSourceCodes: ['skinport', 'csfloat'],
          },
        ],
      },
    ]);
    const overlapAwareSourceUniverseService = {
      selectPriorityBatches: selectPriorityBatchesMock,
    } as unknown as OverlapAwareSourceUniverseService;
    const service = new SteamSnapshotUniverseService(
      createConfigServiceMock(),
      overlapAwareSourceUniverseService,
    );

    const batches = await service.selectPriorityBatches();

    expect(selectPriorityBatchesMock).toHaveBeenCalledWith({
      source: 'steam-snapshot',
      batchBudget: 1,
      batchSize: 5,
      staleAfterMs: 2 * 60 * 60 * 1000,
    });
    expect(batches).toEqual([
      {
        batchId: 'steam-snapshot:1:demo',
        targets: [
          {
            canonicalItemId: 'canonical-1',
            itemVariantId: 'variant-1',
            marketHashName: 'AK-47 | Redline (Field-Tested)',
            priorityScore: 120,
            priorityReason: 'cross-market-overlap-anchor',
          },
        ],
      },
    ]);
  });
});
