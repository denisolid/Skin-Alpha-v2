export type AppRuntimeMode = 'all' | 'web' | 'worker';

const APP_RUNTIME_VALUES = new Set<AppRuntimeMode>(['all', 'web', 'worker']);

function readAppRuntime(): AppRuntimeMode {
  const rawValue = process.env.APP_RUNTIME?.trim().toLowerCase();

  if (!rawValue) {
    return 'all';
  }

  if (APP_RUNTIME_VALUES.has(rawValue as AppRuntimeMode)) {
    return rawValue as AppRuntimeMode;
  }

  throw new Error(
    'APP_RUNTIME must be one of "all", "web", or "worker" when provided.',
  );
}

export const APP_RUNTIME = readAppRuntime();
export const IS_TEST_ENVIRONMENT = process.env.NODE_ENV === 'test';
export const RUNS_HTTP_SERVER = APP_RUNTIME !== 'worker';
export const RUNS_BACKGROUND_PROCESSORS =
  !IS_TEST_ENVIRONMENT && APP_RUNTIME !== 'web';
export const RUNS_SCHEDULER = RUNS_BACKGROUND_PROCESSORS;
