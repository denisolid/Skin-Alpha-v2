const APPEND_ONLY_PRISMA_MODELS = [
  'RawPayloadArchive',
  'MarketSnapshot',
] as const;

const APPEND_ONLY_PRISMA_ACTIONS = new Set([
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]);

export class PrismaAppendOnlyModelError extends Error {
  constructor(model: string, action: string) {
    super(
      `Prisma action "${action}" is not allowed on append-only model "${model}".`,
    );
    this.name = 'PrismaAppendOnlyModelError';
  }
}

export function assertAppendOnlyPrismaOperation(
  model: string,
  action: string,
): void {
  if (
    APPEND_ONLY_PRISMA_MODELS.includes(
      model as (typeof APPEND_ONLY_PRISMA_MODELS)[number],
    ) &&
    APPEND_ONLY_PRISMA_ACTIONS.has(action)
  ) {
    throw new PrismaAppendOnlyModelError(model, action);
  }
}

export function createAppendOnlyModelDelegate<T extends object>(
  model: string,
  delegate: T,
): T {
  return new Proxy(delegate, {
    get(target, propertyKey, receiver) {
      if (
        typeof propertyKey === 'string' &&
        APPEND_ONLY_PRISMA_ACTIONS.has(propertyKey)
      ) {
        return (): never => {
          throw new PrismaAppendOnlyModelError(model, propertyKey);
        };
      }

      return Reflect.get(target, propertyKey, receiver);
    },
  });
}

export function guardAppendOnlyTransactionClient<
  T extends {
    readonly rawPayloadArchive: object;
    readonly marketSnapshot: object;
  },
>(transactionClient: T): T {
  const guardedRawPayloadArchiveDelegate = createAppendOnlyModelDelegate(
    'RawPayloadArchive',
    transactionClient.rawPayloadArchive,
  );
  const guardedMarketSnapshotDelegate = createAppendOnlyModelDelegate(
    'MarketSnapshot',
    transactionClient.marketSnapshot,
  );

  return new Proxy(transactionClient, {
    get(target, propertyKey, receiver) {
      if (propertyKey === 'rawPayloadArchive') {
        return guardedRawPayloadArchiveDelegate;
      }

      if (propertyKey === 'marketSnapshot') {
        return guardedMarketSnapshotDelegate;
      }

      return Reflect.get(target, propertyKey, receiver);
    },
  });
}

export { APPEND_ONLY_PRISMA_MODELS };
