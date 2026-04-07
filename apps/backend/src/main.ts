import 'reflect-metadata';

import {
  type INestApplication,
  type INestApplicationContext,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';

import { AppModule } from './app.module';
import { AppConfigService } from './infrastructure/config/app-config.service';
import { AppLoggerService } from './infrastructure/logging/app-logger.service';
import { APP_RUNTIME, RUNS_HTTP_SERVER } from './infrastructure/runtime/runtime-mode';

function registerHealthcheckRoute(app: INestApplication): void {
  app.use('/healthz', (_request: Request, response: Response) => {
    response.status(200).json({
      runtime: APP_RUNTIME,
      status: 'ok',
    });
  });
}

function registerStateChangingOriginGuard(
  app: INestApplication,
  configService: AppConfigService,
): void {
  app.use((request: Request, response: Response, next: NextFunction) => {
    const method = request.method.toUpperCase();

    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      next();
      return;
    }

    if (!configService.isOriginAllowed(request.headers.origin)) {
      response.status(403).json({
        error: 'Forbidden',
        message: 'Origin not allowed.',
        statusCode: 403,
      });
      return;
    }

    next();
  });
}

function registerProcessSignalHandlers(
  app: INestApplicationContext,
  logger: AppLoggerService,
): void {
  let isShuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    logger.log(`Received ${signal}. Starting graceful shutdown.`, 'Bootstrap');

    try {
      await app.close();
    } catch (error) {
      logger.error(
        'Application shutdown failed.',
        error instanceof Error ? error.stack : undefined,
        'Bootstrap',
      );
      process.exitCode = 1;
    } finally {
      setTimeout(() => {
        process.exit(process.exitCode ?? 0);
      }, 0);
    }
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

async function bootstrapHttpApp(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });
  const logger = app.get(AppLoggerService);
  const configService = app.get(AppConfigService);

  app.useLogger(logger);
  app.setGlobalPrefix('api');
  registerHealthcheckRoute(app);
  registerStateChangingOriginGuard(app, configService);
  app.enableCors({
    credentials: true,
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      if (configService.isOriginAllowed(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Not allowed by CORS'));
    },
  });
  registerProcessSignalHandlers(app, logger);

  await app.listen(configService.port, '0.0.0.0');

  logger.log(
    `API runtime (${APP_RUNTIME}) listening on 0.0.0.0:${configService.port}.`,
    'Bootstrap',
  );
}

async function bootstrapWorkerApp(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
  });
  const logger = app.get(AppLoggerService);

  app.useLogger(logger);
  registerProcessSignalHandlers(app, logger);

  logger.log(`Background runtime (${APP_RUNTIME}) started.`, 'Bootstrap');
}

async function bootstrap(): Promise<void> {
  if (RUNS_HTTP_SERVER) {
    await bootstrapHttpApp();
    return;
  }

  await bootstrapWorkerApp();
}

void bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
