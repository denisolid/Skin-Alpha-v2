import { ConsoleLogger, Injectable, type LogLevel } from '@nestjs/common';

const LOG_LEVELS: readonly LogLevel[] = [
  'log',
  'error',
  'warn',
  'debug',
  'verbose',
  'fatal',
] as const;

function isLogLevel(value: string): value is LogLevel {
  return LOG_LEVELS.includes(value as LogLevel);
}

function resolveLogLevels(): LogLevel[] {
  const configuredLevels =
    process.env.LOG_LEVEL
      ?.split(',')
      .map((value) => value.trim().toLowerCase())
      .filter((value): value is LogLevel => value.length > 0 && isLogLevel(value)) ??
    [];

  if (configuredLevels.length > 0) {
    return configuredLevels;
  }

  if (process.env.NODE_ENV === 'production') {
    return ['log', 'warn', 'error'];
  }

  return ['log', 'warn', 'error', 'debug', 'verbose'];
}

@Injectable()
export class AppLoggerService extends ConsoleLogger {
  constructor() {
    super(AppLoggerService.name, {
      logLevels: resolveLogLevels(),
      timestamp: true,
    });
  }
}
