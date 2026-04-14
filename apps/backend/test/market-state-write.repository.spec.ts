import type { Prisma } from '@prisma/client';

import { MarketStateWriteRepositoryAdapter } from '../src/modules/market-state/infrastructure/market-state-write.repository';

describe('MarketStateWriteRepositoryAdapter', () => {
  it('casts UUID inputs in the heartbeat refresh raw query', async () => {
    const sourceId = '2d614f7b-7a37-4ff2-a5d3-61ee6c6d8b4a';
    const equivalentRawPayloadArchiveId =
      '99e32283-e241-4b22-9f48-88711ffcb0aa';
    const observedAt = new Date('2026-04-13T18:48:18.000Z');
    const queryResult = [
      {
        sourceId,
        sourceCode: 'skinport',
        canonicalItemId: 'canonical-1',
        itemVariantId: '5e7078d7-3109-420f-9751-130bb1029f67',
        marketStateId: '2a7d5d90-1d7e-45fc-a078-db3258f15f17',
        latestSnapshotId: 'e447fe38-867d-4af2-b27a-4191f290c771',
        observedAt,
      },
    ];
    const prismaService = {
      $queryRaw: jest.fn().mockResolvedValue(queryResult),
    };
    const repository = new MarketStateWriteRepositoryAdapter(
      prismaService as never,
    );

    const result = await repository.refreshLatestStateHeartbeat({
      sourceId,
      sourceCode: 'skinport',
      equivalentRawPayloadArchiveId,
      observedAt,
    });

    expect(result).toEqual(queryResult);
    expect(prismaService.$queryRaw).toHaveBeenCalledTimes(1);

    const [sql] = prismaService.$queryRaw.mock.calls[0] as [Prisma.Sql];
    const renderedQuery = sql as unknown as {
      readonly text: string;
      readonly values: readonly unknown[];
    };

    expect(renderedQuery.text).toContain('smf."sourceId" = $4::uuid');
    expect(renderedQuery.text).toContain(
      'smf."rawPayloadArchiveId" = $5::uuid',
    );
    expect(renderedQuery.values[3]).toBe(sourceId);
    expect(renderedQuery.values[4]).toBe(equivalentRawPayloadArchiveId);
  });
});
