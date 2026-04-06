import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { WatchlistsController } from './controllers/watchlists.controller';
import { WATCHLISTS_REPOSITORY } from './domain/watchlists.repository';
import { WatchlistsRepositoryAdapter } from './infrastructure/watchlists.repository';
import { WatchlistsService } from './services/watchlists.service';

@Module({
  imports: [AuthModule],
  controllers: [WatchlistsController],
  providers: [
    WatchlistsService,
    {
      provide: WATCHLISTS_REPOSITORY,
      useClass: WatchlistsRepositoryAdapter,
    },
  ],
})
export class WatchlistsModule {}
