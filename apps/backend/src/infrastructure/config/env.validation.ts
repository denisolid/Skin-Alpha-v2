export type NodeEnvironment = 'development' | 'test' | 'production';

export interface EnvironmentVariables {
  NODE_ENV: NodeEnvironment;
  APP_NAME: string;
  PORT: number;
  FRONTEND_URL: string;
  DATABASE_URL: string;
  REDIS_HOST: string;
  REDIS_PORT: number;
  REDIS_USERNAME?: string;
  REDIS_PASSWORD?: string;
  QUEUE_PREFIX: string;
  SESSION_COOKIE_NAME: string;
  SESSION_TTL_DAYS: number;
  SESSION_SECURE_COOKIE: boolean;
  AUTH_STATE_TTL_SECONDS: number;
  AUTH_EXTERNAL_REDIRECT_URL: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  GOOGLE_OIDC_DISCOVERY_URL: string;
  STEAM_API_KEY?: string;
  STEAM_OPENID_REALM?: string;
  STEAM_OPENID_RETURN_URL?: string;
  STEAM_OPENID_ENDPOINT: string;
  SKINPORT_API_BASE_URL: string;
  SKINPORT_WEBSOCKET_URL: string;
  SKINPORT_CURRENCY: string;
  SKINPORT_APP_ID: number;
  SKINPORT_TRADABLE_ONLY: boolean;
  SKINPORT_ITEMS_SYNC_ENABLED: boolean;
  SKINPORT_SALES_HISTORY_SYNC_ENABLED: boolean;
  SKINPORT_WEBSOCKET_ENABLED: boolean;
  SKINPORT_WEBSOCKET_LOCALE: string;
  SKINPORT_CACHE_TTL_SECONDS: number;
  SKINPORT_RATE_LIMIT_WINDOW_SECONDS: number;
  SKINPORT_RATE_LIMIT_MAX_REQUESTS: number;
  SKINPORT_CLIENT_ID?: string;
  SKINPORT_CLIENT_SECRET?: string;
  CSFLOAT_API_BASE_URL: string;
  CSFLOAT_API_KEY?: string;
  CSFLOAT_CURRENCY: string;
  CSFLOAT_FULL_SYNC_ENABLED: boolean;
  CSFLOAT_HOT_UNIVERSE_SYNC_ENABLED: boolean;
  CSFLOAT_LISTINGS_PAGE_LIMIT: number;
  CSFLOAT_LISTINGS_PAGE_BUDGET: number;
  CSFLOAT_DETAIL_JOB_BUDGET: number;
  CSFLOAT_LISTINGS_RATE_LIMIT_WINDOW_SECONDS: number;
  CSFLOAT_LISTINGS_RATE_LIMIT_MAX_REQUESTS: number;
  CSFLOAT_DETAIL_RATE_LIMIT_WINDOW_SECONDS: number;
  CSFLOAT_DETAIL_RATE_LIMIT_MAX_REQUESTS: number;
  ENABLE_YOUPIN: boolean;
  YOUPIN_REFERENCE_ONLY: boolean;
  YOUPIN_API_BASE_URL: string;
  YOUPIN_API_KEY?: string;
  YOUPIN_CURRENCY: string;
  YOUPIN_PAGE_LIMIT: number;
  YOUPIN_BATCH_SIZE: number;
  YOUPIN_BATCH_BUDGET: number;
  YOUPIN_RATE_LIMIT_WINDOW_SECONDS: number;
  YOUPIN_RATE_LIMIT_MAX_REQUESTS: number;
  ENABLE_BITSKINS: boolean;
  BITSKINS_API_BASE_URL: string;
  BITSKINS_API_KEY?: string;
  BITSKINS_CURRENCY: string;
  BITSKINS_PAGE_LIMIT: number;
  BITSKINS_BATCH_SIZE: number;
  BITSKINS_BATCH_BUDGET: number;
  BITSKINS_RATE_LIMIT_WINDOW_SECONDS: number;
  BITSKINS_RATE_LIMIT_MAX_REQUESTS: number;
  ENABLE_C5GAME: boolean;
  C5GAME_API_BASE_URL: string;
  C5GAME_API_KEY?: string;
  C5GAME_CURRENCY: string;
  C5GAME_PAGE_LIMIT: number;
  C5GAME_BATCH_SIZE: number;
  C5GAME_BATCH_BUDGET: number;
  C5GAME_RATE_LIMIT_WINDOW_SECONDS: number;
  C5GAME_RATE_LIMIT_MAX_REQUESTS: number;
  ENABLE_CSMONEY: boolean;
  CSMONEY_API_BASE_URL: string;
  CSMONEY_API_KEY?: string;
  CSMONEY_CURRENCY: string;
  CSMONEY_PAGE_LIMIT: number;
  CSMONEY_BATCH_SIZE: number;
  CSMONEY_BATCH_BUDGET: number;
  CSMONEY_RATE_LIMIT_WINDOW_SECONDS: number;
  CSMONEY_RATE_LIMIT_MAX_REQUESTS: number;
  STEAM_SNAPSHOT_ENABLED: boolean;
  STEAM_SNAPSHOT_API_BASE_URL: string;
  STEAM_SNAPSHOT_APP_ID: number;
  STEAM_SNAPSHOT_CURRENCY_CODE: number;
  STEAM_SNAPSHOT_COUNTRY: string;
  STEAM_SNAPSHOT_LANGUAGE: string;
  STEAM_SNAPSHOT_BATCH_SIZE: number;
  STEAM_SNAPSHOT_BATCH_BUDGET: number;
  STEAM_SNAPSHOT_REQUEST_DELAY_MS: number;
  STEAM_SNAPSHOT_STALE_AFTER_MINUTES: number;
  STEAM_SNAPSHOT_MAX_STALE_MINUTES: number;
  STEAM_SNAPSHOT_RATE_LIMIT_WINDOW_SECONDS: number;
  STEAM_SNAPSHOT_RATE_LIMIT_MAX_REQUESTS: number;
  BACKUP_AGGREGATOR_ENABLED: boolean;
  BACKUP_AGGREGATOR_BATCH_SIZE: number;
  BACKUP_AGGREGATOR_BATCH_BUDGET: number;
  BACKUP_AGGREGATOR_STALE_AFTER_MINUTES: number;
  BACKUP_AGGREGATOR_CS2SH_ENABLED: boolean;
  BACKUP_AGGREGATOR_CS2SH_API_BASE_URL: string;
  BACKUP_AGGREGATOR_CS2SH_API_KEY?: string;
  BACKUP_AGGREGATOR_CS2SH_REQUEST_TIMEOUT_MS: number;
  BACKUP_AGGREGATOR_CS2SH_REFERENCE_SOURCES: string;
  SCHEDULER_ENABLED: boolean;
  SCHEDULER_FAILURE_COOLDOWN_MINUTES: number;
  SCHEDULER_DEGRADED_INTERVAL_MULTIPLIER: number;
  SCHEDULER_DOWN_INTERVAL_MULTIPLIER: number;
  SCHEDULER_CSFLOAT_MIN_INTERVAL_MINUTES: number;
  SCHEDULER_STEAM_SNAPSHOT_MIN_INTERVAL_MINUTES: number;
  SCHEDULER_SKINPORT_MIN_INTERVAL_MINUTES: number;
  SCHEDULER_BITSKINS_MIN_INTERVAL_MINUTES: number;
  SCHEDULER_BACKUP_SOURCE_MIN_INTERVAL_MINUTES: number;
  SCHEDULER_MARKET_STATE_REBUILD_ENABLED: boolean;
  SCHEDULER_MARKET_STATE_REBUILD_MIN_INTERVAL_MINUTES: number;
  SCHEDULER_OPPORTUNITY_RESCAN_ENABLED: boolean;
  SCHEDULER_OPPORTUNITY_RESCAN_MIN_INTERVAL_MINUTES: number;
  SCHEDULER_OPPORTUNITY_RESCAN_MIN_CHANGED_STATES: number;
  SCHEDULER_OPPORTUNITY_RESCAN_MIN_HOT_UPDATES: number;
}

function readString(value: unknown, key: string, fallback?: string): string {
  const candidate =
    typeof value === 'string' && value.length > 0 ? value : fallback;

  if (!candidate) {
    throw new Error(`Environment variable ${key} is required.`);
  }

  return candidate;
}

function readNumber(value: unknown, key: string, fallback: number): number {
  const rawValue =
    typeof value === 'string' && value.length > 0 ? value : String(fallback);
  const parsedValue = Number(rawValue);

  if (Number.isNaN(parsedValue)) {
    throw new Error(`Environment variable ${key} must be a valid number.`);
  }

  return parsedValue;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string' && value.length > 0) {
    return value.toLowerCase() === 'true';
  }

  return fallback;
}

export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const nodeEnv = readString(config.NODE_ENV, 'NODE_ENV', 'development');

  if (
    nodeEnv !== 'development' &&
    nodeEnv !== 'test' &&
    nodeEnv !== 'production'
  ) {
    throw new Error(
      'NODE_ENV must be one of development, test, or production.',
    );
  }

  const redisUsername =
    typeof config.REDIS_USERNAME === 'string' &&
    config.REDIS_USERNAME.length > 0
      ? config.REDIS_USERNAME
      : undefined;
  const redisPassword =
    typeof config.REDIS_PASSWORD === 'string' &&
    config.REDIS_PASSWORD.length > 0
      ? config.REDIS_PASSWORD
      : undefined;
  const googleClientId =
    typeof config.GOOGLE_CLIENT_ID === 'string' &&
    config.GOOGLE_CLIENT_ID.length > 0
      ? config.GOOGLE_CLIENT_ID
      : undefined;
  const googleClientSecret =
    typeof config.GOOGLE_CLIENT_SECRET === 'string' &&
    config.GOOGLE_CLIENT_SECRET.length > 0
      ? config.GOOGLE_CLIENT_SECRET
      : undefined;
  const googleRedirectUri =
    typeof config.GOOGLE_REDIRECT_URI === 'string' &&
    config.GOOGLE_REDIRECT_URI.length > 0
      ? config.GOOGLE_REDIRECT_URI
      : undefined;
  const steamApiKey =
    typeof config.STEAM_API_KEY === 'string' && config.STEAM_API_KEY.length > 0
      ? config.STEAM_API_KEY
      : undefined;
  const steamOpenIdRealm =
    typeof config.STEAM_OPENID_REALM === 'string' &&
    config.STEAM_OPENID_REALM.length > 0
      ? config.STEAM_OPENID_REALM
      : undefined;
  const steamOpenIdReturnUrl =
    typeof config.STEAM_OPENID_RETURN_URL === 'string' &&
    config.STEAM_OPENID_RETURN_URL.length > 0
      ? config.STEAM_OPENID_RETURN_URL
      : undefined;
  const skinportClientId =
    typeof config.SKINPORT_CLIENT_ID === 'string' &&
    config.SKINPORT_CLIENT_ID.length > 0
      ? config.SKINPORT_CLIENT_ID
      : undefined;
  const skinportClientSecret =
    typeof config.SKINPORT_CLIENT_SECRET === 'string' &&
    config.SKINPORT_CLIENT_SECRET.length > 0
      ? config.SKINPORT_CLIENT_SECRET
      : undefined;
  const csfloatApiKey =
    typeof config.CSFLOAT_API_KEY === 'string' &&
    config.CSFLOAT_API_KEY.length > 0
      ? config.CSFLOAT_API_KEY
      : undefined;
  const youpinApiKey =
    typeof config.YOUPIN_API_KEY === 'string' &&
    config.YOUPIN_API_KEY.length > 0
      ? config.YOUPIN_API_KEY
      : undefined;
  const bitskinsApiKey =
    typeof config.BITSKINS_API_KEY === 'string' &&
    config.BITSKINS_API_KEY.length > 0
      ? config.BITSKINS_API_KEY
      : undefined;
  const c5gameApiKey =
    typeof config.C5GAME_API_KEY === 'string' &&
    config.C5GAME_API_KEY.length > 0
      ? config.C5GAME_API_KEY
      : undefined;
  const csmoneyApiKey =
    typeof config.CSMONEY_API_KEY === 'string' &&
    config.CSMONEY_API_KEY.length > 0
      ? config.CSMONEY_API_KEY
      : undefined;
  const backupAggregatorCs2ShApiKey =
    typeof config.BACKUP_AGGREGATOR_CS2SH_API_KEY === 'string' &&
    config.BACKUP_AGGREGATOR_CS2SH_API_KEY.length > 0
      ? config.BACKUP_AGGREGATOR_CS2SH_API_KEY
      : undefined;

  return {
    NODE_ENV: nodeEnv,
    APP_NAME: readString(config.APP_NAME, 'APP_NAME', 'SkinAlpha v2 API'),
    PORT: readNumber(config.PORT, 'PORT', 3001),
    FRONTEND_URL: readString(
      config.FRONTEND_URL,
      'FRONTEND_URL',
      'http://localhost:3000',
    ),
    DATABASE_URL: readString(
      config.DATABASE_URL,
      'DATABASE_URL',
      'postgresql://postgres:postgres@localhost:5432/skinalpha_v2?schema=public',
    ),
    REDIS_HOST: readString(config.REDIS_HOST, 'REDIS_HOST', 'localhost'),
    REDIS_PORT: readNumber(config.REDIS_PORT, 'REDIS_PORT', 6379),
    QUEUE_PREFIX: readString(
      config.QUEUE_PREFIX,
      'QUEUE_PREFIX',
      'skinalpha:v2',
    ),
    SESSION_COOKIE_NAME: readString(
      config.SESSION_COOKIE_NAME,
      'SESSION_COOKIE_NAME',
      'skinalpha_session',
    ),
    SESSION_TTL_DAYS: readNumber(
      config.SESSION_TTL_DAYS,
      'SESSION_TTL_DAYS',
      30,
    ),
    SESSION_SECURE_COOKIE: readBoolean(
      config.SESSION_SECURE_COOKIE,
      nodeEnv === 'production',
    ),
    AUTH_STATE_TTL_SECONDS: readNumber(
      config.AUTH_STATE_TTL_SECONDS,
      'AUTH_STATE_TTL_SECONDS',
      600,
    ),
    AUTH_EXTERNAL_REDIRECT_URL: readString(
      config.AUTH_EXTERNAL_REDIRECT_URL,
      'AUTH_EXTERNAL_REDIRECT_URL',
      'http://localhost:3000',
    ),
    GOOGLE_OIDC_DISCOVERY_URL: readString(
      config.GOOGLE_OIDC_DISCOVERY_URL,
      'GOOGLE_OIDC_DISCOVERY_URL',
      'https://accounts.google.com/.well-known/openid-configuration',
    ),
    STEAM_OPENID_ENDPOINT: readString(
      config.STEAM_OPENID_ENDPOINT,
      'STEAM_OPENID_ENDPOINT',
      'https://steamcommunity.com/openid/login',
    ),
    SKINPORT_API_BASE_URL: readString(
      config.SKINPORT_API_BASE_URL,
      'SKINPORT_API_BASE_URL',
      'https://api.skinport.com/v1',
    ),
    SKINPORT_WEBSOCKET_URL: readString(
      config.SKINPORT_WEBSOCKET_URL,
      'SKINPORT_WEBSOCKET_URL',
      'wss://skinport.com',
    ),
    SKINPORT_CURRENCY: readString(
      config.SKINPORT_CURRENCY,
      'SKINPORT_CURRENCY',
      'EUR',
    ),
    SKINPORT_APP_ID: readNumber(config.SKINPORT_APP_ID, 'SKINPORT_APP_ID', 730),
    SKINPORT_TRADABLE_ONLY: readBoolean(config.SKINPORT_TRADABLE_ONLY, true),
    SKINPORT_ITEMS_SYNC_ENABLED: readBoolean(
      config.SKINPORT_ITEMS_SYNC_ENABLED,
      true,
    ),
    SKINPORT_SALES_HISTORY_SYNC_ENABLED: readBoolean(
      config.SKINPORT_SALES_HISTORY_SYNC_ENABLED,
      true,
    ),
    SKINPORT_WEBSOCKET_ENABLED: readBoolean(
      config.SKINPORT_WEBSOCKET_ENABLED,
      false,
    ),
    SKINPORT_WEBSOCKET_LOCALE: readString(
      config.SKINPORT_WEBSOCKET_LOCALE,
      'SKINPORT_WEBSOCKET_LOCALE',
      'en',
    ),
    SKINPORT_CACHE_TTL_SECONDS: readNumber(
      config.SKINPORT_CACHE_TTL_SECONDS,
      'SKINPORT_CACHE_TTL_SECONDS',
      300,
    ),
    SKINPORT_RATE_LIMIT_WINDOW_SECONDS: readNumber(
      config.SKINPORT_RATE_LIMIT_WINDOW_SECONDS,
      'SKINPORT_RATE_LIMIT_WINDOW_SECONDS',
      300,
    ),
    SKINPORT_RATE_LIMIT_MAX_REQUESTS: readNumber(
      config.SKINPORT_RATE_LIMIT_MAX_REQUESTS,
      'SKINPORT_RATE_LIMIT_MAX_REQUESTS',
      8,
    ),
    CSFLOAT_API_BASE_URL: readString(
      config.CSFLOAT_API_BASE_URL,
      'CSFLOAT_API_BASE_URL',
      'https://csfloat.com/api/v1',
    ),
    CSFLOAT_CURRENCY: readString(
      config.CSFLOAT_CURRENCY,
      'CSFLOAT_CURRENCY',
      'USD',
    ),
    CSFLOAT_FULL_SYNC_ENABLED: readBoolean(
      config.CSFLOAT_FULL_SYNC_ENABLED,
      true,
    ),
    CSFLOAT_HOT_UNIVERSE_SYNC_ENABLED: readBoolean(
      config.CSFLOAT_HOT_UNIVERSE_SYNC_ENABLED,
      true,
    ),
    CSFLOAT_LISTINGS_PAGE_LIMIT: readNumber(
      config.CSFLOAT_LISTINGS_PAGE_LIMIT,
      'CSFLOAT_LISTINGS_PAGE_LIMIT',
      50,
    ),
    CSFLOAT_LISTINGS_PAGE_BUDGET: readNumber(
      config.CSFLOAT_LISTINGS_PAGE_BUDGET,
      'CSFLOAT_LISTINGS_PAGE_BUDGET',
      10,
    ),
    CSFLOAT_DETAIL_JOB_BUDGET: readNumber(
      config.CSFLOAT_DETAIL_JOB_BUDGET,
      'CSFLOAT_DETAIL_JOB_BUDGET',
      5,
    ),
    CSFLOAT_LISTINGS_RATE_LIMIT_WINDOW_SECONDS: readNumber(
      config.CSFLOAT_LISTINGS_RATE_LIMIT_WINDOW_SECONDS,
      'CSFLOAT_LISTINGS_RATE_LIMIT_WINDOW_SECONDS',
      60,
    ),
    CSFLOAT_LISTINGS_RATE_LIMIT_MAX_REQUESTS: readNumber(
      config.CSFLOAT_LISTINGS_RATE_LIMIT_MAX_REQUESTS,
      'CSFLOAT_LISTINGS_RATE_LIMIT_MAX_REQUESTS',
      20,
    ),
    CSFLOAT_DETAIL_RATE_LIMIT_WINDOW_SECONDS: readNumber(
      config.CSFLOAT_DETAIL_RATE_LIMIT_WINDOW_SECONDS,
      'CSFLOAT_DETAIL_RATE_LIMIT_WINDOW_SECONDS',
      60,
    ),
    CSFLOAT_DETAIL_RATE_LIMIT_MAX_REQUESTS: readNumber(
      config.CSFLOAT_DETAIL_RATE_LIMIT_MAX_REQUESTS,
      'CSFLOAT_DETAIL_RATE_LIMIT_MAX_REQUESTS',
      20,
    ),
    ENABLE_YOUPIN: readBoolean(config.ENABLE_YOUPIN, false),
    YOUPIN_REFERENCE_ONLY: readBoolean(config.YOUPIN_REFERENCE_ONLY, false),
    YOUPIN_API_BASE_URL: readString(
      config.YOUPIN_API_BASE_URL,
      'YOUPIN_API_BASE_URL',
      'https://api.youpin898.com',
    ),
    YOUPIN_CURRENCY: readString(
      config.YOUPIN_CURRENCY,
      'YOUPIN_CURRENCY',
      'CNY',
    ),
    YOUPIN_PAGE_LIMIT: readNumber(
      config.YOUPIN_PAGE_LIMIT,
      'YOUPIN_PAGE_LIMIT',
      50,
    ),
    YOUPIN_BATCH_SIZE: readNumber(
      config.YOUPIN_BATCH_SIZE,
      'YOUPIN_BATCH_SIZE',
      20,
    ),
    YOUPIN_BATCH_BUDGET: readNumber(
      config.YOUPIN_BATCH_BUDGET,
      'YOUPIN_BATCH_BUDGET',
      4,
    ),
    YOUPIN_RATE_LIMIT_WINDOW_SECONDS: readNumber(
      config.YOUPIN_RATE_LIMIT_WINDOW_SECONDS,
      'YOUPIN_RATE_LIMIT_WINDOW_SECONDS',
      60,
    ),
    YOUPIN_RATE_LIMIT_MAX_REQUESTS: readNumber(
      config.YOUPIN_RATE_LIMIT_MAX_REQUESTS,
      'YOUPIN_RATE_LIMIT_MAX_REQUESTS',
      20,
    ),
    ENABLE_BITSKINS: readBoolean(config.ENABLE_BITSKINS, false),
    BITSKINS_API_BASE_URL: readString(
      config.BITSKINS_API_BASE_URL,
      'BITSKINS_API_BASE_URL',
      'https://api.bitskins.com',
    ),
    BITSKINS_CURRENCY: readString(
      config.BITSKINS_CURRENCY,
      'BITSKINS_CURRENCY',
      'USD',
    ),
    BITSKINS_PAGE_LIMIT: readNumber(
      config.BITSKINS_PAGE_LIMIT,
      'BITSKINS_PAGE_LIMIT',
      50,
    ),
    BITSKINS_BATCH_SIZE: readNumber(
      config.BITSKINS_BATCH_SIZE,
      'BITSKINS_BATCH_SIZE',
      20,
    ),
    BITSKINS_BATCH_BUDGET: readNumber(
      config.BITSKINS_BATCH_BUDGET,
      'BITSKINS_BATCH_BUDGET',
      4,
    ),
    BITSKINS_RATE_LIMIT_WINDOW_SECONDS: readNumber(
      config.BITSKINS_RATE_LIMIT_WINDOW_SECONDS,
      'BITSKINS_RATE_LIMIT_WINDOW_SECONDS',
      60,
    ),
    BITSKINS_RATE_LIMIT_MAX_REQUESTS: readNumber(
      config.BITSKINS_RATE_LIMIT_MAX_REQUESTS,
      'BITSKINS_RATE_LIMIT_MAX_REQUESTS',
      20,
    ),
    ENABLE_C5GAME: readBoolean(config.ENABLE_C5GAME, false),
    C5GAME_API_BASE_URL: readString(
      config.C5GAME_API_BASE_URL,
      'C5GAME_API_BASE_URL',
      'https://api.c5game.com',
    ),
    C5GAME_CURRENCY: readString(
      config.C5GAME_CURRENCY,
      'C5GAME_CURRENCY',
      'CNY',
    ),
    C5GAME_PAGE_LIMIT: readNumber(
      config.C5GAME_PAGE_LIMIT,
      'C5GAME_PAGE_LIMIT',
      50,
    ),
    C5GAME_BATCH_SIZE: readNumber(
      config.C5GAME_BATCH_SIZE,
      'C5GAME_BATCH_SIZE',
      16,
    ),
    C5GAME_BATCH_BUDGET: readNumber(
      config.C5GAME_BATCH_BUDGET,
      'C5GAME_BATCH_BUDGET',
      3,
    ),
    C5GAME_RATE_LIMIT_WINDOW_SECONDS: readNumber(
      config.C5GAME_RATE_LIMIT_WINDOW_SECONDS,
      'C5GAME_RATE_LIMIT_WINDOW_SECONDS',
      60,
    ),
    C5GAME_RATE_LIMIT_MAX_REQUESTS: readNumber(
      config.C5GAME_RATE_LIMIT_MAX_REQUESTS,
      'C5GAME_RATE_LIMIT_MAX_REQUESTS',
      12,
    ),
    ENABLE_CSMONEY: readBoolean(config.ENABLE_CSMONEY, false),
    CSMONEY_API_BASE_URL: readString(
      config.CSMONEY_API_BASE_URL,
      'CSMONEY_API_BASE_URL',
      'https://cs.money',
    ),
    CSMONEY_CURRENCY: readString(
      config.CSMONEY_CURRENCY,
      'CSMONEY_CURRENCY',
      'USD',
    ),
    CSMONEY_PAGE_LIMIT: readNumber(
      config.CSMONEY_PAGE_LIMIT,
      'CSMONEY_PAGE_LIMIT',
      50,
    ),
    CSMONEY_BATCH_SIZE: readNumber(
      config.CSMONEY_BATCH_SIZE,
      'CSMONEY_BATCH_SIZE',
      12,
    ),
    CSMONEY_BATCH_BUDGET: readNumber(
      config.CSMONEY_BATCH_BUDGET,
      'CSMONEY_BATCH_BUDGET',
      2,
    ),
    CSMONEY_RATE_LIMIT_WINDOW_SECONDS: readNumber(
      config.CSMONEY_RATE_LIMIT_WINDOW_SECONDS,
      'CSMONEY_RATE_LIMIT_WINDOW_SECONDS',
      60,
    ),
    CSMONEY_RATE_LIMIT_MAX_REQUESTS: readNumber(
      config.CSMONEY_RATE_LIMIT_MAX_REQUESTS,
      'CSMONEY_RATE_LIMIT_MAX_REQUESTS',
      8,
    ),
    STEAM_SNAPSHOT_ENABLED: readBoolean(config.STEAM_SNAPSHOT_ENABLED, true),
    STEAM_SNAPSHOT_API_BASE_URL: readString(
      config.STEAM_SNAPSHOT_API_BASE_URL,
      'STEAM_SNAPSHOT_API_BASE_URL',
      'https://steamcommunity.com/market',
    ),
    STEAM_SNAPSHOT_APP_ID: readNumber(
      config.STEAM_SNAPSHOT_APP_ID,
      'STEAM_SNAPSHOT_APP_ID',
      730,
    ),
    STEAM_SNAPSHOT_CURRENCY_CODE: readNumber(
      config.STEAM_SNAPSHOT_CURRENCY_CODE,
      'STEAM_SNAPSHOT_CURRENCY_CODE',
      1,
    ),
    STEAM_SNAPSHOT_COUNTRY: readString(
      config.STEAM_SNAPSHOT_COUNTRY,
      'STEAM_SNAPSHOT_COUNTRY',
      'US',
    ),
    STEAM_SNAPSHOT_LANGUAGE: readString(
      config.STEAM_SNAPSHOT_LANGUAGE,
      'STEAM_SNAPSHOT_LANGUAGE',
      'english',
    ),
    STEAM_SNAPSHOT_BATCH_SIZE: readNumber(
      config.STEAM_SNAPSHOT_BATCH_SIZE,
      'STEAM_SNAPSHOT_BATCH_SIZE',
      20,
    ),
    STEAM_SNAPSHOT_BATCH_BUDGET: readNumber(
      config.STEAM_SNAPSHOT_BATCH_BUDGET,
      'STEAM_SNAPSHOT_BATCH_BUDGET',
      5,
    ),
    STEAM_SNAPSHOT_REQUEST_DELAY_MS: readNumber(
      config.STEAM_SNAPSHOT_REQUEST_DELAY_MS,
      'STEAM_SNAPSHOT_REQUEST_DELAY_MS',
      1500,
    ),
    STEAM_SNAPSHOT_STALE_AFTER_MINUTES: readNumber(
      config.STEAM_SNAPSHOT_STALE_AFTER_MINUTES,
      'STEAM_SNAPSHOT_STALE_AFTER_MINUTES',
      120,
    ),
    STEAM_SNAPSHOT_MAX_STALE_MINUTES: readNumber(
      config.STEAM_SNAPSHOT_MAX_STALE_MINUTES,
      'STEAM_SNAPSHOT_MAX_STALE_MINUTES',
      1440,
    ),
    STEAM_SNAPSHOT_RATE_LIMIT_WINDOW_SECONDS: readNumber(
      config.STEAM_SNAPSHOT_RATE_LIMIT_WINDOW_SECONDS,
      'STEAM_SNAPSHOT_RATE_LIMIT_WINDOW_SECONDS',
      60,
    ),
    STEAM_SNAPSHOT_RATE_LIMIT_MAX_REQUESTS: readNumber(
      config.STEAM_SNAPSHOT_RATE_LIMIT_MAX_REQUESTS,
      'STEAM_SNAPSHOT_RATE_LIMIT_MAX_REQUESTS',
      30,
    ),
    BACKUP_AGGREGATOR_ENABLED: readBoolean(
      config.BACKUP_AGGREGATOR_ENABLED,
      true,
    ),
    BACKUP_AGGREGATOR_BATCH_SIZE: readNumber(
      config.BACKUP_AGGREGATOR_BATCH_SIZE,
      'BACKUP_AGGREGATOR_BATCH_SIZE',
      25,
    ),
    BACKUP_AGGREGATOR_BATCH_BUDGET: readNumber(
      config.BACKUP_AGGREGATOR_BATCH_BUDGET,
      'BACKUP_AGGREGATOR_BATCH_BUDGET',
      3,
    ),
    BACKUP_AGGREGATOR_STALE_AFTER_MINUTES: readNumber(
      config.BACKUP_AGGREGATOR_STALE_AFTER_MINUTES,
      'BACKUP_AGGREGATOR_STALE_AFTER_MINUTES',
      240,
    ),
    BACKUP_AGGREGATOR_CS2SH_ENABLED: readBoolean(
      config.BACKUP_AGGREGATOR_CS2SH_ENABLED,
      false,
    ),
    BACKUP_AGGREGATOR_CS2SH_API_BASE_URL: readString(
      config.BACKUP_AGGREGATOR_CS2SH_API_BASE_URL,
      'BACKUP_AGGREGATOR_CS2SH_API_BASE_URL',
      'https://api.cs2.sh',
    ),
    BACKUP_AGGREGATOR_CS2SH_REQUEST_TIMEOUT_MS: readNumber(
      config.BACKUP_AGGREGATOR_CS2SH_REQUEST_TIMEOUT_MS,
      'BACKUP_AGGREGATOR_CS2SH_REQUEST_TIMEOUT_MS',
      20000,
    ),
    BACKUP_AGGREGATOR_CS2SH_REFERENCE_SOURCES: readString(
      config.BACKUP_AGGREGATOR_CS2SH_REFERENCE_SOURCES,
      'BACKUP_AGGREGATOR_CS2SH_REFERENCE_SOURCES',
      'steam,skinport,csfloat',
    ),
    SCHEDULER_ENABLED: readBoolean(config.SCHEDULER_ENABLED, true),
    SCHEDULER_FAILURE_COOLDOWN_MINUTES: readNumber(
      config.SCHEDULER_FAILURE_COOLDOWN_MINUTES,
      'SCHEDULER_FAILURE_COOLDOWN_MINUTES',
      12,
    ),
    SCHEDULER_DEGRADED_INTERVAL_MULTIPLIER: readNumber(
      config.SCHEDULER_DEGRADED_INTERVAL_MULTIPLIER,
      'SCHEDULER_DEGRADED_INTERVAL_MULTIPLIER',
      1.5,
    ),
    SCHEDULER_DOWN_INTERVAL_MULTIPLIER: readNumber(
      config.SCHEDULER_DOWN_INTERVAL_MULTIPLIER,
      'SCHEDULER_DOWN_INTERVAL_MULTIPLIER',
      2.25,
    ),
    SCHEDULER_CSFLOAT_MIN_INTERVAL_MINUTES: readNumber(
      config.SCHEDULER_CSFLOAT_MIN_INTERVAL_MINUTES,
      'SCHEDULER_CSFLOAT_MIN_INTERVAL_MINUTES',
      4,
    ),
    SCHEDULER_STEAM_SNAPSHOT_MIN_INTERVAL_MINUTES: readNumber(
      config.SCHEDULER_STEAM_SNAPSHOT_MIN_INTERVAL_MINUTES,
      'SCHEDULER_STEAM_SNAPSHOT_MIN_INTERVAL_MINUTES',
      7,
    ),
    SCHEDULER_SKINPORT_MIN_INTERVAL_MINUTES: readNumber(
      config.SCHEDULER_SKINPORT_MIN_INTERVAL_MINUTES,
      'SCHEDULER_SKINPORT_MIN_INTERVAL_MINUTES',
      7,
    ),
    SCHEDULER_BITSKINS_MIN_INTERVAL_MINUTES: readNumber(
      config.SCHEDULER_BITSKINS_MIN_INTERVAL_MINUTES,
      'SCHEDULER_BITSKINS_MIN_INTERVAL_MINUTES',
      8,
    ),
    SCHEDULER_BACKUP_SOURCE_MIN_INTERVAL_MINUTES: readNumber(
      config.SCHEDULER_BACKUP_SOURCE_MIN_INTERVAL_MINUTES,
      'SCHEDULER_BACKUP_SOURCE_MIN_INTERVAL_MINUTES',
      15,
    ),
    SCHEDULER_MARKET_STATE_REBUILD_ENABLED: readBoolean(
      config.SCHEDULER_MARKET_STATE_REBUILD_ENABLED,
      false,
    ),
    SCHEDULER_MARKET_STATE_REBUILD_MIN_INTERVAL_MINUTES: readNumber(
      config.SCHEDULER_MARKET_STATE_REBUILD_MIN_INTERVAL_MINUTES,
      'SCHEDULER_MARKET_STATE_REBUILD_MIN_INTERVAL_MINUTES',
      180,
    ),
    SCHEDULER_OPPORTUNITY_RESCAN_ENABLED: readBoolean(
      config.SCHEDULER_OPPORTUNITY_RESCAN_ENABLED,
      true,
    ),
    SCHEDULER_OPPORTUNITY_RESCAN_MIN_INTERVAL_MINUTES: readNumber(
      config.SCHEDULER_OPPORTUNITY_RESCAN_MIN_INTERVAL_MINUTES,
      'SCHEDULER_OPPORTUNITY_RESCAN_MIN_INTERVAL_MINUTES',
      20,
    ),
    SCHEDULER_OPPORTUNITY_RESCAN_MIN_CHANGED_STATES: readNumber(
      config.SCHEDULER_OPPORTUNITY_RESCAN_MIN_CHANGED_STATES,
      'SCHEDULER_OPPORTUNITY_RESCAN_MIN_CHANGED_STATES',
      24,
    ),
    SCHEDULER_OPPORTUNITY_RESCAN_MIN_HOT_UPDATES: readNumber(
      config.SCHEDULER_OPPORTUNITY_RESCAN_MIN_HOT_UPDATES,
      'SCHEDULER_OPPORTUNITY_RESCAN_MIN_HOT_UPDATES',
      6,
    ),
    ...(redisUsername ? { REDIS_USERNAME: redisUsername } : {}),
    ...(redisPassword ? { REDIS_PASSWORD: redisPassword } : {}),
    ...(googleClientId ? { GOOGLE_CLIENT_ID: googleClientId } : {}),
    ...(googleClientSecret ? { GOOGLE_CLIENT_SECRET: googleClientSecret } : {}),
    ...(googleRedirectUri ? { GOOGLE_REDIRECT_URI: googleRedirectUri } : {}),
    ...(steamApiKey ? { STEAM_API_KEY: steamApiKey } : {}),
    ...(steamOpenIdRealm ? { STEAM_OPENID_REALM: steamOpenIdRealm } : {}),
    ...(steamOpenIdReturnUrl
      ? { STEAM_OPENID_RETURN_URL: steamOpenIdReturnUrl }
      : {}),
    ...(skinportClientId ? { SKINPORT_CLIENT_ID: skinportClientId } : {}),
    ...(skinportClientSecret
      ? { SKINPORT_CLIENT_SECRET: skinportClientSecret }
      : {}),
    ...(csfloatApiKey ? { CSFLOAT_API_KEY: csfloatApiKey } : {}),
    ...(youpinApiKey ? { YOUPIN_API_KEY: youpinApiKey } : {}),
    ...(bitskinsApiKey ? { BITSKINS_API_KEY: bitskinsApiKey } : {}),
    ...(c5gameApiKey ? { C5GAME_API_KEY: c5gameApiKey } : {}),
    ...(csmoneyApiKey ? { CSMONEY_API_KEY: csmoneyApiKey } : {}),
    ...(backupAggregatorCs2ShApiKey
      ? { BACKUP_AGGREGATOR_CS2SH_API_KEY: backupAggregatorCs2ShApiKey }
      : {}),
  };
}
