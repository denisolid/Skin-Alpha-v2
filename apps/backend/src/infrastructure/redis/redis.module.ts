import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';

import { AppConfigService } from '../config/app-config.service';
import { REDIS_CLIENT } from './redis.constants';
import { ReadPathDegradationService } from './read-path-degradation.service';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [AppConfigService],
      useFactory: (configService: AppConfigService): Redis =>
        new Redis({
          ...configService.redisConnectionOptions,
          lazyConnect: true,
          maxRetriesPerRequest: null,
        }),
    },
    RedisService,
    ReadPathDegradationService,
  ],
  exports: [REDIS_CLIENT, RedisService, ReadPathDegradationService],
})
export class RedisModule {}
