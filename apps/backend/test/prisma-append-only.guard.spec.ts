import {
  PrismaAppendOnlyModelError,
  assertAppendOnlyPrismaOperation,
  guardAppendOnlyTransactionClient,
} from '../src/infrastructure/prisma/prisma-append-only.guard';

describe('assertAppendOnlyPrismaOperation', () => {
  it.each([
    'create',
    'createMany',
    'findFirst',
    'findMany',
    'findUnique',
    'aggregate',
  ])('allows %s on append-only models', (action) => {
    expect(() =>
      assertAppendOnlyPrismaOperation('RawPayloadArchive', action),
    ).not.toThrow();
  });

  it.each(['update', 'updateMany', 'upsert', 'delete', 'deleteMany'])(
    'rejects %s on raw payload archives',
    (action) => {
      expect(() =>
        assertAppendOnlyPrismaOperation('RawPayloadArchive', action),
      ).toThrow(PrismaAppendOnlyModelError);
    },
  );

  it('rejects updates on market snapshots', () => {
    expect(() =>
      assertAppendOnlyPrismaOperation('MarketSnapshot', 'update'),
    ).toThrow(
      'Prisma action "update" is not allowed on append-only model "MarketSnapshot".',
    );
  });

  it('ignores non-append-only models', () => {
    expect(() =>
      assertAppendOnlyPrismaOperation('MarketState', 'upsert'),
    ).not.toThrow();
  });

  it('guards append-only delegates on transaction clients', () => {
    const guardedClient = guardAppendOnlyTransactionClient({
      rawPayloadArchive: {
        create: jest.fn(),
        update: jest.fn(),
      },
      marketSnapshot: {
        create: jest.fn(),
        delete: jest.fn(),
      },
    });

    expect(() => {
      guardedClient.rawPayloadArchive.update();
    }).toThrow(PrismaAppendOnlyModelError);
    expect(() => {
      guardedClient.marketSnapshot.delete();
    }).toThrow(PrismaAppendOnlyModelError);
    expect(guardedClient.rawPayloadArchive.create).toBeDefined();
  });
});
