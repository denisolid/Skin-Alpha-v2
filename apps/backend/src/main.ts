import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { AppConfigService } from './infrastructure/config/app-config.service';
import { AppLoggerService } from './infrastructure/logging/app-logger.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });
  const logger = app.get(AppLoggerService);
  const configService = app.get(AppConfigService);

  app.useLogger(logger);
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: configService.frontendUrl,
    credentials: true,
  });
  app.enableShutdownHooks();

  await app.listen(configService.port, '0.0.0.0');

  logger.log(
    `API is running on http://localhost:${configService.port}/api`,
    'Bootstrap',
  );
}

void bootstrap();
