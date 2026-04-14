import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RedisOptions } from 'ioredis';

import type {
  EnvironmentVariables,
  NodeEnvironment,
  SessionCookieSameSite,
} from './env.validation';

function defaultPortForProtocol(protocol: string): string {
  if (protocol === 'https:') {
    return '443';
  }

  if (protocol === 'http:') {
    return '80';
  }

  return '';
}

function parseOriginUrl(value: string): {
  readonly hostname: string;
  readonly origin: string;
  readonly port: string;
  readonly protocol: string;
} | null {
  try {
    const url = new URL(value);

    return {
      hostname: url.hostname.toLowerCase(),
      origin: url.origin.toLowerCase(),
      port: url.port || defaultPortForProtocol(url.protocol),
      protocol: url.protocol,
    };
  } catch {
    return null;
  }
}

function parseOriginPattern(value: string): {
  readonly hostname: string;
  readonly origin?: string;
  readonly port: string;
  readonly protocol: string;
  readonly wildcard: boolean;
} | null {
  const wildcardMatch = value
    .trim()
    .match(/^(https?):\/\/\*\.(.+?)(?::(\d+))?$/i);

  if (wildcardMatch) {
    const protocol = `${wildcardMatch[1]!.toLowerCase()}:`;

    return {
      protocol,
      hostname: `.${wildcardMatch[2]!.toLowerCase()}`,
      port: wildcardMatch[3] || defaultPortForProtocol(protocol),
      wildcard: true,
    };
  }

  const parsedOrigin = parseOriginUrl(value.trim());

  if (!parsedOrigin) {
    return null;
  }

  return {
    origin: parsedOrigin.origin,
    protocol: parsedOrigin.protocol,
    hostname: parsedOrigin.hostname,
    port: parsedOrigin.port,
    wildcard: false,
  };
}

function matchesOriginPattern(pattern: string, origin: string): boolean {
  const parsedPattern = parseOriginPattern(pattern);
  const parsedOrigin = parseOriginUrl(origin);

  if (!parsedPattern || !parsedOrigin) {
    return false;
  }

  if (
    parsedPattern.protocol !== parsedOrigin.protocol ||
    parsedPattern.port !== parsedOrigin.port
  ) {
    return false;
  }

  if (!parsedPattern.wildcard) {
    return parsedPattern.origin === parsedOrigin.origin;
  }

  return (
    parsedOrigin.hostname.endsWith(parsedPattern.hostname) &&
    parsedOrigin.hostname.length > parsedPattern.hostname.length
  );
}

@Injectable()
export class AppConfigService {
  constructor(
    @Inject(ConfigService)
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  get nodeEnv(): NodeEnvironment {
    return this.configService.getOrThrow('NODE_ENV', {
      infer: true,
    });
  }

  get appName(): string {
    return this.configService.getOrThrow('APP_NAME', {
      infer: true,
    });
  }

  get port(): number {
    return this.configService.getOrThrow('PORT', {
      infer: true,
    });
  }

  get frontendUrl(): string {
    return this.configService.getOrThrow('FRONTEND_URL', {
      infer: true,
    });
  }

  get corsAllowedOrigins(): readonly string[] {
    const extraOrigins =
      this.configService
        .get('CORS_ALLOWED_ORIGINS', {
          infer: true,
        })
        ?.split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0) ?? [];

    return [this.frontendUrl, ...extraOrigins];
  }

  get databaseUrl(): string {
    return this.configService.getOrThrow('DATABASE_URL', {
      infer: true,
    });
  }

  get queuePrefix(): string {
    return this.configService.getOrThrow('QUEUE_PREFIX', {
      infer: true,
    });
  }

  get redisHost(): string {
    return this.configService.getOrThrow('REDIS_HOST', {
      infer: true,
    });
  }

  get redisUrl(): string | undefined {
    return this.configService.get('REDIS_URL', {
      infer: true,
    });
  }

  get redisPort(): number {
    return this.configService.getOrThrow('REDIS_PORT', {
      infer: true,
    });
  }

  get redisUsername(): string | undefined {
    return this.configService.get('REDIS_USERNAME', {
      infer: true,
    });
  }

  get redisPassword(): string | undefined {
    return this.configService.get('REDIS_PASSWORD', {
      infer: true,
    });
  }

  get redisConnectionOptions(): RedisOptions {
    if (this.redisUrl) {
      const url = new URL(this.redisUrl);

      return {
        host: url.hostname,
        port: url.port ? Number(url.port) : 6379,
        ...(this.redisUsername || url.username
          ? {
              username: this.redisUsername || decodeURIComponent(url.username),
            }
          : {}),
        ...(this.redisPassword || url.password
          ? {
              password: this.redisPassword || decodeURIComponent(url.password),
            }
          : {}),
        ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
      };
    }

    return {
      host: this.redisHost,
      port: this.redisPort,
      ...(this.redisUsername ? { username: this.redisUsername } : {}),
      ...(this.redisPassword ? { password: this.redisPassword } : {}),
    };
  }

  get sessionCookieName(): string {
    return this.configService.getOrThrow('SESSION_COOKIE_NAME', {
      infer: true,
    });
  }

  get sessionTtlDays(): number {
    return this.configService.getOrThrow('SESSION_TTL_DAYS', {
      infer: true,
    });
  }

  get sessionTtlMs(): number {
    return this.sessionTtlDays * 24 * 60 * 60 * 1000;
  }

  get sessionSecureCookie(): boolean {
    return this.configService.getOrThrow('SESSION_SECURE_COOKIE', {
      infer: true,
    });
  }

  get sessionCookieSameSite(): SessionCookieSameSite {
    return this.configService.getOrThrow('SESSION_COOKIE_SAME_SITE', {
      infer: true,
    });
  }

  get authStateTtlSeconds(): number {
    return this.configService.getOrThrow('AUTH_STATE_TTL_SECONDS', {
      infer: true,
    });
  }

  get authExternalRedirectUrl(): string {
    return this.configService.getOrThrow('AUTH_EXTERNAL_REDIRECT_URL', {
      infer: true,
    });
  }

  get googleClientId(): string | undefined {
    return this.configService.get('GOOGLE_CLIENT_ID', {
      infer: true,
    });
  }

  get googleClientSecret(): string | undefined {
    return this.configService.get('GOOGLE_CLIENT_SECRET', {
      infer: true,
    });
  }

  get googleRedirectUri(): string | undefined {
    return this.configService.get('GOOGLE_REDIRECT_URI', {
      infer: true,
    });
  }

  get googleDiscoveryUrl(): string {
    return this.configService.getOrThrow('GOOGLE_OIDC_DISCOVERY_URL', {
      infer: true,
    });
  }

  get steamApiKey(): string | undefined {
    return this.configService.get('STEAM_API_KEY', {
      infer: true,
    });
  }

  get steamOpenIdRealm(): string | undefined {
    return this.configService.get('STEAM_OPENID_REALM', {
      infer: true,
    });
  }

  get steamOpenIdReturnUrl(): string | undefined {
    return this.configService.get('STEAM_OPENID_RETURN_URL', {
      infer: true,
    });
  }

  get steamOpenIdEndpoint(): string {
    return this.configService.getOrThrow('STEAM_OPENID_ENDPOINT', {
      infer: true,
    });
  }

  get skinportApiBaseUrl(): string {
    return this.configService.getOrThrow('SKINPORT_API_BASE_URL', {
      infer: true,
    });
  }

  get skinportWebsocketUrl(): string {
    return this.configService.getOrThrow('SKINPORT_WEBSOCKET_URL', {
      infer: true,
    });
  }

  get skinportCurrency(): string {
    return this.configService.getOrThrow('SKINPORT_CURRENCY', {
      infer: true,
    });
  }

  get skinportAppId(): number {
    return this.configService.getOrThrow('SKINPORT_APP_ID', {
      infer: true,
    });
  }

  get skinportTradableOnly(): boolean {
    return this.configService.getOrThrow('SKINPORT_TRADABLE_ONLY', {
      infer: true,
    });
  }

  get skinportItemsSyncEnabled(): boolean {
    return this.configService.getOrThrow('SKINPORT_ITEMS_SYNC_ENABLED', {
      infer: true,
    });
  }

  get skinportSalesHistorySyncEnabled(): boolean {
    return this.configService.getOrThrow(
      'SKINPORT_SALES_HISTORY_SYNC_ENABLED',
      {
        infer: true,
      },
    );
  }

  get skinportWebsocketEnabled(): boolean {
    return this.configService.getOrThrow('SKINPORT_WEBSOCKET_ENABLED', {
      infer: true,
    });
  }

  get skinportWebsocketLocale(): string {
    return this.configService.getOrThrow('SKINPORT_WEBSOCKET_LOCALE', {
      infer: true,
    });
  }

  get skinportCacheTtlSeconds(): number {
    return this.configService.getOrThrow('SKINPORT_CACHE_TTL_SECONDS', {
      infer: true,
    });
  }

  get skinportCacheTtlMs(): number {
    return this.skinportCacheTtlSeconds * 1000;
  }

  get skinportRateLimitWindowSeconds(): number {
    return this.configService.getOrThrow('SKINPORT_RATE_LIMIT_WINDOW_SECONDS', {
      infer: true,
    });
  }

  get skinportRateLimitMaxRequests(): number {
    return this.configService.getOrThrow('SKINPORT_RATE_LIMIT_MAX_REQUESTS', {
      infer: true,
    });
  }

  get skinportClientId(): string | undefined {
    return this.configService.get('SKINPORT_CLIENT_ID', {
      infer: true,
    });
  }

  get skinportClientSecret(): string | undefined {
    return this.configService.get('SKINPORT_CLIENT_SECRET', {
      infer: true,
    });
  }

  get csfloatApiBaseUrl(): string {
    return this.configService.getOrThrow('CSFLOAT_API_BASE_URL', {
      infer: true,
    });
  }

  get csfloatApiKey(): string | undefined {
    return this.configService.get('CSFLOAT_API_KEY', {
      infer: true,
    });
  }

  get csfloatCurrency(): string {
    return this.configService.getOrThrow('CSFLOAT_CURRENCY', {
      infer: true,
    });
  }

  get csfloatFullSyncEnabled(): boolean {
    return this.configService.getOrThrow('CSFLOAT_FULL_SYNC_ENABLED', {
      infer: true,
    });
  }

  get csfloatHotUniverseSyncEnabled(): boolean {
    return this.configService.getOrThrow('CSFLOAT_HOT_UNIVERSE_SYNC_ENABLED', {
      infer: true,
    });
  }

  get csfloatListingsPageLimit(): number {
    return this.configService.getOrThrow('CSFLOAT_LISTINGS_PAGE_LIMIT', {
      infer: true,
    });
  }

  get csfloatListingsPageBudget(): number {
    return this.configService.getOrThrow('CSFLOAT_LISTINGS_PAGE_BUDGET', {
      infer: true,
    });
  }

  get csfloatDetailJobBudget(): number {
    return this.configService.getOrThrow('CSFLOAT_DETAIL_JOB_BUDGET', {
      infer: true,
    });
  }

  get csfloatListingsRateLimitWindowSeconds(): number {
    return this.configService.getOrThrow(
      'CSFLOAT_LISTINGS_RATE_LIMIT_WINDOW_SECONDS',
      {
        infer: true,
      },
    );
  }

  get csfloatListingsRateLimitMaxRequests(): number {
    return this.configService.getOrThrow(
      'CSFLOAT_LISTINGS_RATE_LIMIT_MAX_REQUESTS',
      {
        infer: true,
      },
    );
  }

  get csfloatDetailRateLimitWindowSeconds(): number {
    return this.configService.getOrThrow(
      'CSFLOAT_DETAIL_RATE_LIMIT_WINDOW_SECONDS',
      {
        infer: true,
      },
    );
  }

  get csfloatDetailRateLimitMaxRequests(): number {
    return this.configService.getOrThrow(
      'CSFLOAT_DETAIL_RATE_LIMIT_MAX_REQUESTS',
      {
        infer: true,
      },
    );
  }

  get enableDMarket(): boolean {
    return this.configService.getOrThrow('ENABLE_DMARKET', {
      infer: true,
    });
  }

  get dmarketApiBaseUrl(): string {
    return this.configService.getOrThrow('DMARKET_API_BASE_URL', {
      infer: true,
    });
  }

  get dmarketPublicKey(): string | undefined {
    return this.configService.get('DMARKET_PUBLIC_KEY', {
      infer: true,
    });
  }

  get dmarketSecretKey(): string | undefined {
    return this.configService.get('DMARKET_SECRET_KEY', {
      infer: true,
    });
  }

  get dmarketCurrency(): string {
    return this.configService.getOrThrow('DMARKET_CURRENCY', {
      infer: true,
    });
  }

  get dmarketPageLimit(): number {
    return this.configService.getOrThrow('DMARKET_PAGE_LIMIT', {
      infer: true,
    });
  }

  get dmarketBatchSize(): number {
    return this.configService.getOrThrow('DMARKET_BATCH_SIZE', {
      infer: true,
    });
  }

  get dmarketBatchBudget(): number {
    return this.configService.getOrThrow('DMARKET_BATCH_BUDGET', {
      infer: true,
    });
  }

  get dmarketRateLimitWindowSeconds(): number {
    return this.configService.getOrThrow('DMARKET_RATE_LIMIT_WINDOW_SECONDS', {
      infer: true,
    });
  }

  get dmarketRateLimitMaxRequests(): number {
    return this.configService.getOrThrow('DMARKET_RATE_LIMIT_MAX_REQUESTS', {
      infer: true,
    });
  }

  get enableWaxpeer(): boolean {
    return this.configService.getOrThrow('ENABLE_WAXPEER', {
      infer: true,
    });
  }

  get waxpeerApiBaseUrl(): string {
    return this.configService.getOrThrow('WAXPEER_API_BASE_URL', {
      infer: true,
    });
  }

  get waxpeerApiKey(): string | undefined {
    return this.configService.get('WAXPEER_API_KEY', {
      infer: true,
    });
  }

  get waxpeerGame(): string {
    return this.configService.getOrThrow('WAXPEER_GAME', {
      infer: true,
    });
  }

  get waxpeerCurrency(): string {
    return this.configService.getOrThrow('WAXPEER_CURRENCY', {
      infer: true,
    });
  }

  get waxpeerNameBatchSize(): number {
    return this.configService.getOrThrow('WAXPEER_NAME_BATCH_SIZE', {
      infer: true,
    });
  }

  get waxpeerBatchBudget(): number {
    return this.configService.getOrThrow('WAXPEER_BATCH_BUDGET', {
      infer: true,
    });
  }

  get waxpeerRateLimitWindowSeconds(): number {
    return this.configService.getOrThrow('WAXPEER_RATE_LIMIT_WINDOW_SECONDS', {
      infer: true,
    });
  }

  get waxpeerRateLimitMaxRequests(): number {
    return this.configService.getOrThrow('WAXPEER_RATE_LIMIT_MAX_REQUESTS', {
      infer: true,
    });
  }

  get enableYouPin(): boolean {
    return this.configService.getOrThrow('ENABLE_YOUPIN', {
      infer: true,
    });
  }

  get youpinReferenceOnly(): boolean {
    return this.configService.getOrThrow('YOUPIN_REFERENCE_ONLY', {
      infer: true,
    });
  }

  get youpinApiBaseUrl(): string {
    return this.configService.getOrThrow('YOUPIN_API_BASE_URL', {
      infer: true,
    });
  }

  get youpinApiKey(): string | undefined {
    return this.configService.get('YOUPIN_API_KEY', {
      infer: true,
    });
  }

  get youpinCurrency(): string {
    return this.configService.getOrThrow('YOUPIN_CURRENCY', {
      infer: true,
    });
  }

  get youpinPageLimit(): number {
    return this.configService.getOrThrow('YOUPIN_PAGE_LIMIT', {
      infer: true,
    });
  }

  get youpinBatchSize(): number {
    return this.configService.getOrThrow('YOUPIN_BATCH_SIZE', {
      infer: true,
    });
  }

  get youpinBatchBudget(): number {
    return this.configService.getOrThrow('YOUPIN_BATCH_BUDGET', {
      infer: true,
    });
  }

  get youpinRateLimitWindowSeconds(): number {
    return this.configService.getOrThrow('YOUPIN_RATE_LIMIT_WINDOW_SECONDS', {
      infer: true,
    });
  }

  get youpinRateLimitMaxRequests(): number {
    return this.configService.getOrThrow('YOUPIN_RATE_LIMIT_MAX_REQUESTS', {
      infer: true,
    });
  }

  get enableBitSkins(): boolean {
    return this.configService.getOrThrow('ENABLE_BITSKINS', {
      infer: true,
    });
  }

  get bitskinsApiBaseUrl(): string {
    return this.configService.getOrThrow('BITSKINS_API_BASE_URL', {
      infer: true,
    });
  }

  get bitskinsApiKey(): string | undefined {
    return this.configService.get('BITSKINS_API_KEY', {
      infer: true,
    });
  }

  get bitskinsCurrency(): string {
    return this.configService.getOrThrow('BITSKINS_CURRENCY', {
      infer: true,
    });
  }

  get bitskinsPageLimit(): number {
    return this.configService.getOrThrow('BITSKINS_PAGE_LIMIT', {
      infer: true,
    });
  }

  get bitskinsBatchSize(): number {
    return this.configService.getOrThrow('BITSKINS_BATCH_SIZE', {
      infer: true,
    });
  }

  get bitskinsBatchBudget(): number {
    return this.configService.getOrThrow('BITSKINS_BATCH_BUDGET', {
      infer: true,
    });
  }

  get bitskinsRateLimitWindowSeconds(): number {
    return this.configService.getOrThrow('BITSKINS_RATE_LIMIT_WINDOW_SECONDS', {
      infer: true,
    });
  }

  get bitskinsRateLimitMaxRequests(): number {
    return this.configService.getOrThrow('BITSKINS_RATE_LIMIT_MAX_REQUESTS', {
      infer: true,
    });
  }

  get enableC5Game(): boolean {
    return this.configService.getOrThrow('ENABLE_C5GAME', {
      infer: true,
    });
  }

  get c5gameApiBaseUrl(): string {
    return this.configService.getOrThrow('C5GAME_API_BASE_URL', {
      infer: true,
    });
  }

  get c5gameApiKey(): string | undefined {
    return this.configService.get('C5GAME_API_KEY', {
      infer: true,
    });
  }

  get c5gameCurrency(): string {
    return this.configService.getOrThrow('C5GAME_CURRENCY', {
      infer: true,
    });
  }

  get c5gamePageLimit(): number {
    return this.configService.getOrThrow('C5GAME_PAGE_LIMIT', {
      infer: true,
    });
  }

  get c5gameBatchSize(): number {
    return this.configService.getOrThrow('C5GAME_BATCH_SIZE', {
      infer: true,
    });
  }

  get c5gameBatchBudget(): number {
    return this.configService.getOrThrow('C5GAME_BATCH_BUDGET', {
      infer: true,
    });
  }

  get c5gameRateLimitWindowSeconds(): number {
    return this.configService.getOrThrow('C5GAME_RATE_LIMIT_WINDOW_SECONDS', {
      infer: true,
    });
  }

  get c5gameRateLimitMaxRequests(): number {
    return this.configService.getOrThrow('C5GAME_RATE_LIMIT_MAX_REQUESTS', {
      infer: true,
    });
  }

  get enableCSMoney(): boolean {
    return this.configService.getOrThrow('ENABLE_CSMONEY', {
      infer: true,
    });
  }

  get csmoneyApiBaseUrl(): string {
    return this.configService.getOrThrow('CSMONEY_API_BASE_URL', {
      infer: true,
    });
  }

  get csmoneyApiKey(): string | undefined {
    return this.configService.get('CSMONEY_API_KEY', {
      infer: true,
    });
  }

  get csmoneyCurrency(): string {
    return this.configService.getOrThrow('CSMONEY_CURRENCY', {
      infer: true,
    });
  }

  get csmoneyPageLimit(): number {
    return this.configService.getOrThrow('CSMONEY_PAGE_LIMIT', {
      infer: true,
    });
  }

  get csmoneyBatchSize(): number {
    return this.configService.getOrThrow('CSMONEY_BATCH_SIZE', {
      infer: true,
    });
  }

  get csmoneyBatchBudget(): number {
    return this.configService.getOrThrow('CSMONEY_BATCH_BUDGET', {
      infer: true,
    });
  }

  get csmoneyRateLimitWindowSeconds(): number {
    return this.configService.getOrThrow('CSMONEY_RATE_LIMIT_WINDOW_SECONDS', {
      infer: true,
    });
  }

  get csmoneyRateLimitMaxRequests(): number {
    return this.configService.getOrThrow('CSMONEY_RATE_LIMIT_MAX_REQUESTS', {
      infer: true,
    });
  }

  get steamSnapshotEnabled(): boolean {
    return this.configService.getOrThrow('STEAM_SNAPSHOT_ENABLED', {
      infer: true,
    });
  }

  get steamSnapshotApiBaseUrl(): string {
    return this.configService.getOrThrow('STEAM_SNAPSHOT_API_BASE_URL', {
      infer: true,
    });
  }

  get steamSnapshotAppId(): number {
    return this.configService.getOrThrow('STEAM_SNAPSHOT_APP_ID', {
      infer: true,
    });
  }

  get steamSnapshotCurrencyCode(): number {
    return this.configService.getOrThrow('STEAM_SNAPSHOT_CURRENCY_CODE', {
      infer: true,
    });
  }

  get steamSnapshotCountry(): string {
    return this.configService.getOrThrow('STEAM_SNAPSHOT_COUNTRY', {
      infer: true,
    });
  }

  get steamSnapshotLanguage(): string {
    return this.configService.getOrThrow('STEAM_SNAPSHOT_LANGUAGE', {
      infer: true,
    });
  }

  get steamSnapshotBatchSize(): number {
    return this.configService.getOrThrow('STEAM_SNAPSHOT_BATCH_SIZE', {
      infer: true,
    });
  }

  get steamSnapshotBatchBudget(): number {
    return this.configService.getOrThrow('STEAM_SNAPSHOT_BATCH_BUDGET', {
      infer: true,
    });
  }

  get steamSnapshotRequestDelayMs(): number {
    return this.configService.getOrThrow('STEAM_SNAPSHOT_REQUEST_DELAY_MS', {
      infer: true,
    });
  }

  get steamSnapshotStaleAfterMinutes(): number {
    return this.configService.getOrThrow('STEAM_SNAPSHOT_STALE_AFTER_MINUTES', {
      infer: true,
    });
  }

  get steamSnapshotMaxStaleMinutes(): number {
    return this.configService.getOrThrow('STEAM_SNAPSHOT_MAX_STALE_MINUTES', {
      infer: true,
    });
  }

  get steamSnapshotStaleAfterMs(): number {
    return this.steamSnapshotStaleAfterMinutes * 60 * 1000;
  }

  get steamSnapshotMaxStaleMs(): number {
    return this.steamSnapshotMaxStaleMinutes * 60 * 1000;
  }

  get steamSnapshotRateLimitWindowSeconds(): number {
    return this.configService.getOrThrow(
      'STEAM_SNAPSHOT_RATE_LIMIT_WINDOW_SECONDS',
      {
        infer: true,
      },
    );
  }

  get steamSnapshotRateLimitMaxRequests(): number {
    return this.configService.getOrThrow(
      'STEAM_SNAPSHOT_RATE_LIMIT_MAX_REQUESTS',
      {
        infer: true,
      },
    );
  }

  get backupAggregatorEnabled(): boolean {
    return this.configService.getOrThrow('BACKUP_AGGREGATOR_ENABLED', {
      infer: true,
    });
  }

  get backupAggregatorBatchSize(): number {
    return this.configService.getOrThrow('BACKUP_AGGREGATOR_BATCH_SIZE', {
      infer: true,
    });
  }

  get backupAggregatorBatchBudget(): number {
    return this.configService.getOrThrow('BACKUP_AGGREGATOR_BATCH_BUDGET', {
      infer: true,
    });
  }

  get backupAggregatorStaleAfterMinutes(): number {
    return this.configService.getOrThrow(
      'BACKUP_AGGREGATOR_STALE_AFTER_MINUTES',
      {
        infer: true,
      },
    );
  }

  get backupAggregatorStaleAfterMs(): number {
    return this.backupAggregatorStaleAfterMinutes * 60 * 1000;
  }

  get backupAggregatorCs2ShEnabled(): boolean {
    return this.configService.getOrThrow('BACKUP_AGGREGATOR_CS2SH_ENABLED', {
      infer: true,
    });
  }

  get backupAggregatorCs2ShApiBaseUrl(): string {
    return this.configService.getOrThrow(
      'BACKUP_AGGREGATOR_CS2SH_API_BASE_URL',
      {
        infer: true,
      },
    );
  }

  get backupAggregatorCs2ShApiKey(): string | undefined {
    return this.configService.get('BACKUP_AGGREGATOR_CS2SH_API_KEY', {
      infer: true,
    });
  }

  get backupAggregatorCs2ShRequestTimeoutMs(): number {
    return this.configService.getOrThrow(
      'BACKUP_AGGREGATOR_CS2SH_REQUEST_TIMEOUT_MS',
      {
        infer: true,
      },
    );
  }

  get backupAggregatorCs2ShReferenceSources(): readonly string[] {
    const rawValue = this.configService.getOrThrow(
      'BACKUP_AGGREGATOR_CS2SH_REFERENCE_SOURCES',
      {
        infer: true,
      },
    );

    return rawValue
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0);
  }

  get schedulerEnabled(): boolean {
    return this.configService.getOrThrow('SCHEDULER_ENABLED', {
      infer: true,
    });
  }

  get schedulerFailureCooldownMinutes(): number {
    return this.configService.getOrThrow('SCHEDULER_FAILURE_COOLDOWN_MINUTES', {
      infer: true,
    });
  }

  get schedulerFailureCooldownMs(): number {
    return this.schedulerFailureCooldownMinutes * 60 * 1000;
  }

  get schedulerDegradedIntervalMultiplier(): number {
    return this.configService.getOrThrow(
      'SCHEDULER_DEGRADED_INTERVAL_MULTIPLIER',
      {
        infer: true,
      },
    );
  }

  get schedulerDownIntervalMultiplier(): number {
    return this.configService.getOrThrow('SCHEDULER_DOWN_INTERVAL_MULTIPLIER', {
      infer: true,
    });
  }

  get schedulerCsFloatMinIntervalMinutes(): number {
    return this.configService.getOrThrow(
      'SCHEDULER_CSFLOAT_MIN_INTERVAL_MINUTES',
      {
        infer: true,
      },
    );
  }

  get schedulerCsFloatMinIntervalMs(): number {
    return this.schedulerCsFloatMinIntervalMinutes * 60 * 1000;
  }

  get schedulerDMarketMinIntervalMinutes(): number {
    return this.configService.getOrThrow(
      'SCHEDULER_DMARKET_MIN_INTERVAL_MINUTES',
      {
        infer: true,
      },
    );
  }

  get schedulerDMarketMinIntervalMs(): number {
    return this.schedulerDMarketMinIntervalMinutes * 60 * 1000;
  }

  get schedulerWaxpeerMinIntervalMinutes(): number {
    return this.configService.getOrThrow(
      'SCHEDULER_WAXPEER_MIN_INTERVAL_MINUTES',
      {
        infer: true,
      },
    );
  }

  get schedulerWaxpeerMinIntervalMs(): number {
    return this.schedulerWaxpeerMinIntervalMinutes * 60 * 1000;
  }

  get schedulerSteamSnapshotMinIntervalMinutes(): number {
    return this.configService.getOrThrow(
      'SCHEDULER_STEAM_SNAPSHOT_MIN_INTERVAL_MINUTES',
      {
        infer: true,
      },
    );
  }

  get schedulerSteamSnapshotMinIntervalMs(): number {
    return this.schedulerSteamSnapshotMinIntervalMinutes * 60 * 1000;
  }

  get schedulerSkinportMinIntervalMinutes(): number {
    return this.configService.getOrThrow(
      'SCHEDULER_SKINPORT_MIN_INTERVAL_MINUTES',
      {
        infer: true,
      },
    );
  }

  get schedulerSkinportMinIntervalMs(): number {
    return this.schedulerSkinportMinIntervalMinutes * 60 * 1000;
  }

  get schedulerBitSkinsMinIntervalMinutes(): number {
    return this.configService.getOrThrow(
      'SCHEDULER_BITSKINS_MIN_INTERVAL_MINUTES',
      {
        infer: true,
      },
    );
  }

  get schedulerBitSkinsMinIntervalMs(): number {
    return this.schedulerBitSkinsMinIntervalMinutes * 60 * 1000;
  }

  get schedulerBackupSourceMinIntervalMinutes(): number {
    return this.configService.getOrThrow(
      'SCHEDULER_BACKUP_SOURCE_MIN_INTERVAL_MINUTES',
      {
        infer: true,
      },
    );
  }

  get schedulerBackupSourceMinIntervalMs(): number {
    return this.schedulerBackupSourceMinIntervalMinutes * 60 * 1000;
  }

  get schedulerMarketStateRebuildEnabled(): boolean {
    return this.configService.getOrThrow(
      'SCHEDULER_MARKET_STATE_REBUILD_ENABLED',
      {
        infer: true,
      },
    );
  }

  get schedulerMarketStateRebuildMinIntervalMinutes(): number {
    return this.configService.getOrThrow(
      'SCHEDULER_MARKET_STATE_REBUILD_MIN_INTERVAL_MINUTES',
      {
        infer: true,
      },
    );
  }

  get schedulerMarketStateRebuildMinIntervalMs(): number {
    return this.schedulerMarketStateRebuildMinIntervalMinutes * 60 * 1000;
  }

  get schedulerOpportunityRescanEnabled(): boolean {
    return this.configService.getOrThrow(
      'SCHEDULER_OPPORTUNITY_RESCAN_ENABLED',
      {
        infer: true,
      },
    );
  }

  get schedulerOpportunityRescanMinIntervalMinutes(): number {
    return this.configService.getOrThrow(
      'SCHEDULER_OPPORTUNITY_RESCAN_MIN_INTERVAL_MINUTES',
      {
        infer: true,
      },
    );
  }

  get schedulerOpportunityRescanMinIntervalMs(): number {
    return this.schedulerOpportunityRescanMinIntervalMinutes * 60 * 1000;
  }

  get schedulerOpportunityRescanMinChangedStates(): number {
    return this.configService.getOrThrow(
      'SCHEDULER_OPPORTUNITY_RESCAN_MIN_CHANGED_STATES',
      {
        infer: true,
      },
    );
  }

  get schedulerOpportunityRescanMinHotUpdates(): number {
    return this.configService.getOrThrow(
      'SCHEDULER_OPPORTUNITY_RESCAN_MIN_HOT_UPDATES',
      {
        infer: true,
      },
    );
  }

  isGoogleAuthConfigured(): boolean {
    return Boolean(
      this.googleClientId && this.googleClientSecret && this.googleRedirectUri,
    );
  }

  isSteamAuthConfigured(): boolean {
    return Boolean(this.steamOpenIdRealm && this.steamOpenIdReturnUrl);
  }

  isCsFloatConfigured(): boolean {
    return Boolean(this.csfloatApiKey);
  }

  isDMarketEnabled(): boolean {
    return Boolean(
      this.enableDMarket && this.dmarketPublicKey && this.dmarketSecretKey,
    );
  }

  isWaxpeerEnabled(): boolean {
    return Boolean(this.enableWaxpeer && this.waxpeerApiKey);
  }

  isYouPinEnabled(): boolean {
    return this.enableYouPin;
  }

  isYouPinPrimaryTruthEnabled(): boolean {
    return this.enableYouPin && !this.youpinReferenceOnly;
  }

  isBitSkinsEnabled(): boolean {
    return this.enableBitSkins;
  }

  isC5GameEnabled(): boolean {
    return this.enableC5Game;
  }

  isCSMoneyEnabled(): boolean {
    return this.enableCSMoney;
  }

  isSteamSnapshotEnabled(): boolean {
    return this.steamSnapshotEnabled;
  }

  isBackupAggregatorEnabled(): boolean {
    return this.backupAggregatorEnabled;
  }

  isBackupAggregatorCs2ShEnabled(): boolean {
    return Boolean(
      this.backupAggregatorEnabled &&
      this.backupAggregatorCs2ShEnabled &&
      this.backupAggregatorCs2ShApiKey,
    );
  }

  isTestEnvironment(): boolean {
    return this.nodeEnv === 'test';
  }

  isOriginAllowed(origin?: string | null): boolean {
    if (!origin) {
      return true;
    }

    return this.corsAllowedOrigins.some((pattern) =>
      matchesOriginPattern(pattern, origin),
    );
  }
}
