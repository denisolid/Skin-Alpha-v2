import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient, type Prisma } from '@prisma/client';
import type { ITXClientDenyList } from '@prisma/client/runtime/library';

import { AppConfigService } from '../config/app-config.service';
import {
  createAppendOnlyModelDelegate,
  guardAppendOnlyTransactionClient,
} from './prisma-append-only.guard';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
  ) {
    super({
      datasources: {
        db: {
          url: configService.databaseUrl,
        },
      },
    });
  }

  override get rawPayloadArchive(): PrismaClient['rawPayloadArchive'] {
    return createAppendOnlyModelDelegate(
      'RawPayloadArchive',
      super.rawPayloadArchive,
    );
  }

  override get marketSnapshot(): PrismaClient['marketSnapshot'] {
    return createAppendOnlyModelDelegate(
      'MarketSnapshot',
      super.marketSnapshot,
    );
  }

  override $transaction<P extends Prisma.PrismaPromise<unknown>[]>(
    arg: [...P],
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<{ [K in keyof P]: Awaited<P[K]> }>;
  override $transaction<R>(
    fn: (prisma: Omit<PrismaClient, ITXClientDenyList>) => Promise<R>,
    options?: {
      maxWait?: number;
      timeout?: number;
      isolationLevel?: Prisma.TransactionIsolationLevel;
    },
  ): Promise<R>;
  override $transaction<R>(
    arg:
      | Prisma.PrismaPromise<unknown>[]
      | ((prisma: Omit<PrismaClient, ITXClientDenyList>) => Promise<R>),
    options?:
      | { isolationLevel?: Prisma.TransactionIsolationLevel }
      | {
          maxWait?: number;
          timeout?: number;
          isolationLevel?: Prisma.TransactionIsolationLevel;
        },
  ): Promise<unknown> {
    if (typeof arg !== 'function') {
      return super.$transaction(
        arg,
        options as { isolationLevel?: Prisma.TransactionIsolationLevel },
      );
    }

    return super.$transaction(
      async (transactionClient) =>
        arg(guardAppendOnlyTransactionClient(transactionClient)),
      options as {
        maxWait?: number;
        timeout?: number;
        isolationLevel?: Prisma.TransactionIsolationLevel;
      },
    );
  }

  async onModuleInit(): Promise<void> {
    if (this.configService.isTestEnvironment()) {
      return;
    }

    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
