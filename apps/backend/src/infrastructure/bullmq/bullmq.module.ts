import { BullModule } from '@nestjs/bullmq';
import { Global, type DynamicModule, Module } from '@nestjs/common';

import { AppConfigService } from '../config/app-config.service';

@Global()
@Module({})
export class BullMqModule {
  static register(): DynamicModule {
    if (process.env.NODE_ENV === 'test') {
      return {
        module: BullMqModule,
      };
    }

    return {
      module: BullMqModule,
      imports: [
        BullModule.forRootAsync({
          inject: [AppConfigService],
          useFactory: (configService: AppConfigService) => ({
            prefix: configService.queuePrefix,
            connection: {
              host: configService.redisHost,
              port: configService.redisPort,
              ...(configService.redisUsername
                ? { username: configService.redisUsername }
                : {}),
              ...(configService.redisPassword
                ? { password: configService.redisPassword }
                : {}),
            },
          }),
        }),
      ],
      exports: [BullModule],
    };
  }
}
