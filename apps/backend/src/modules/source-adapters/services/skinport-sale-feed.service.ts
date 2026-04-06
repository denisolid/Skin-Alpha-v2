import {
  Inject,
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';

import { AppConfigService } from '../../../infrastructure/config/app-config.service';
import {
  SKINPORT_INGEST_SALE_FEED_JOB_NAME,
  SKINPORT_INGEST_SALE_FEED_QUEUE,
} from '../domain/skinport.constants';
import type { SourceJobQueue } from '../domain/source-job-queue.port';
import type {
  SkinportSaleFeedEnvelopeDto,
  SkinportSaleFeedJobData,
} from '../dto/skinport-sync.job.dto';

interface SocketLike {
  on(event: string, listener: (...args: unknown[]) => void): void;
  emit(event: string, payload: unknown): void;
  close(): void;
}

@Injectable()
export class SkinportSaleFeedService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private socket: SocketLike | null = null;

  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
    @Inject(SKINPORT_INGEST_SALE_FEED_QUEUE)
    private readonly skinportIngestSaleFeedQueue: SourceJobQueue<SkinportSaleFeedJobData>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (
      this.configService.isTestEnvironment() ||
      !this.configService.skinportWebsocketEnabled
    ) {
      return;
    }

    await this.connect();
  }

  onApplicationShutdown(): void {
    this.socket?.close();
    this.socket = null;
  }

  async connect(): Promise<void> {
    if (this.socket) {
      return;
    }

    const [{ io }, parserModule] = await Promise.all([
      import('socket.io-client'),
      import('socket.io-msgpack-parser'),
    ]);

    const parser = parserModule.default;
    const socket = io(this.configService.skinportWebsocketUrl, {
      path: '/socket.io',
      transports: ['websocket'],
      parser,
    }) as SocketLike;

    socket.on('connect', () => {
      socket.emit('saleFeedJoin', {
        appid: this.configService.skinportAppId,
        currency: this.configService.skinportCurrency,
        locale: this.configService.skinportWebsocketLocale,
      });
    });
    socket.on('saleFeed', (payload: unknown) => {
      void this.skinportIngestSaleFeedQueue.add(
        SKINPORT_INGEST_SALE_FEED_JOB_NAME,
        {
          payload: {
            event: 'saleFeed',
            payload: payload as SkinportSaleFeedEnvelopeDto['payload'],
          },
          observedAt: new Date().toISOString(),
        },
      );
    });

    this.socket = socket;
  }
}
