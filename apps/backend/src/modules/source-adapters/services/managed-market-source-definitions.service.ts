import { Inject, Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../infrastructure/config/app-config.service';
import {
  BITSKINS_LISTINGS_ENDPOINT_NAME,
  BITSKINS_SYNC_QUEUE,
  BITSKINS_SYNC_QUEUE_NAME,
  C5GAME_LISTINGS_ENDPOINT_NAME,
  C5GAME_SYNC_QUEUE,
  C5GAME_SYNC_QUEUE_NAME,
  CSMONEY_LISTINGS_ENDPOINT_NAME,
  CSMONEY_SYNC_QUEUE,
  CSMONEY_SYNC_QUEUE_NAME,
  YOUPIN_LISTINGS_ENDPOINT_NAME,
  YOUPIN_SYNC_QUEUE,
  YOUPIN_SYNC_QUEUE_NAME,
} from '../domain/managed-market.constants';
import type {
  ManagedMarketSourceDefinition,
  ManagedMarketSourceKey,
} from '../domain/managed-market-source.types';

@Injectable()
export class ManagedMarketSourceDefinitionsService {
  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
  ) {}

  get(source: ManagedMarketSourceKey): ManagedMarketSourceDefinition {
    switch (source) {
      case 'bitskins':
        return this.withOptionalApiKey(
          {
            key: 'bitskins',
            displayName: 'BitSkins',
            endpointName: BITSKINS_LISTINGS_ENDPOINT_NAME,
            queueName: BITSKINS_SYNC_QUEUE_NAME,
            queueToken: BITSKINS_SYNC_QUEUE,
            classification: 'PRIMARY',
            behavior: {
              canDrivePrimaryTruth: true,
              canProvideFallbackPricing: true,
              canProvideQuantitySignals: true,
              canBeUsedForPairBuilding: true,
              canBeUsedForConfirmationOnly: true,
            },
            enabled: this.configService.isBitSkinsEnabled(),
            baseUrl: this.configService.bitskinsApiBaseUrl,
            currency: this.configService.bitskinsCurrency,
            pageLimit: this.configService.bitskinsPageLimit,
            batchSize: this.configService.bitskinsBatchSize,
            batchBudget: this.configService.bitskinsBatchBudget,
            rateLimitWindowSeconds:
              this.configService.bitskinsRateLimitWindowSeconds,
            rateLimitMaxRequests:
              this.configService.bitskinsRateLimitMaxRequests,
            retryAttempts: 3,
            retryBaseDelayMs: 750,
            circuitBreakerFailureThreshold: 4,
            circuitBreakerCooldownSeconds: 180,
            targetQueryMode: 'overlap-first',
            requestPath: '/market/insell/730',
            notes: [
              'BitSkins uses the aggregate /market/insell/730 snapshot and filters it down to bounded overlap targets after archive.',
              'The public endpoint currently ignores target query parameters, so only one raw snapshot is fetched per sync.',
            ],
          },
          this.configService.bitskinsApiKey,
        );
      case 'youpin':
        return this.withOptionalApiKey(
          {
            key: 'youpin',
            displayName: 'YouPin',
            endpointName: YOUPIN_LISTINGS_ENDPOINT_NAME,
            queueName: YOUPIN_SYNC_QUEUE_NAME,
            queueToken: YOUPIN_SYNC_QUEUE,
            classification: this.configService.youpinReferenceOnly
              ? 'REFERENCE'
              : 'PRIMARY',
            behavior: {
              canDrivePrimaryTruth:
                this.configService.isYouPinPrimaryTruthEnabled(),
              canProvideFallbackPricing: true,
              canProvideQuantitySignals: true,
              canBeUsedForPairBuilding:
                this.configService.isYouPinPrimaryTruthEnabled(),
              canBeUsedForConfirmationOnly:
                !this.configService.isYouPinPrimaryTruthEnabled(),
            },
            enabled: this.configService.isYouPinEnabled(),
            baseUrl: this.configService.youpinApiBaseUrl,
            currency: this.configService.youpinCurrency,
            pageLimit: this.configService.youpinPageLimit,
            batchSize: this.configService.youpinBatchSize,
            batchBudget: this.configService.youpinBatchBudget,
            rateLimitWindowSeconds:
              this.configService.youpinRateLimitWindowSeconds,
            rateLimitMaxRequests: this.configService.youpinRateLimitMaxRequests,
            retryAttempts: 3,
            retryBaseDelayMs: 900,
            circuitBreakerFailureThreshold: 4,
            circuitBreakerCooldownSeconds: 240,
            targetQueryMode: 'overlap-first',
            requestPath: '/api/homepage/price/market',
            notes: [
              'YouPin can run as a primary direct source or a reference-only confirmation source depending on YOUPIN_REFERENCE_ONLY.',
              'Credentials and exact request path are configured through env placeholders.',
            ],
          },
          this.configService.youpinApiKey,
        );
      case 'c5game':
        return this.withOptionalApiKey(
          {
            key: 'c5game',
            displayName: 'C5Game',
            endpointName: C5GAME_LISTINGS_ENDPOINT_NAME,
            queueName: C5GAME_SYNC_QUEUE_NAME,
            queueToken: C5GAME_SYNC_QUEUE,
            classification: 'OPTIONAL',
            behavior: {
              canDrivePrimaryTruth: true,
              canProvideFallbackPricing: true,
              canProvideQuantitySignals: true,
              canBeUsedForPairBuilding: true,
              canBeUsedForConfirmationOnly: true,
            },
            enabled: this.configService.isC5GameEnabled(),
            baseUrl: this.configService.c5gameApiBaseUrl,
            currency: this.configService.c5gameCurrency,
            pageLimit: this.configService.c5gamePageLimit,
            batchSize: this.configService.c5gameBatchSize,
            batchBudget: this.configService.c5gameBatchBudget,
            rateLimitWindowSeconds:
              this.configService.c5gameRateLimitWindowSeconds,
            rateLimitMaxRequests: this.configService.c5gameRateLimitMaxRequests,
            retryAttempts: 2,
            retryBaseDelayMs: 1000,
            circuitBreakerFailureThreshold: 3,
            circuitBreakerCooldownSeconds: 300,
            targetQueryMode: 'hot-universe',
            requestPath: '/market/listings',
            notes: [
              'C5Game is feature-flagged and intentionally optional.',
              'Enable only when credentials and response shape validation are in place.',
            ],
          },
          this.configService.c5gameApiKey,
        );
      case 'csmoney':
        return this.withOptionalApiKey(
          {
            key: 'csmoney',
            displayName: 'CS.MONEY',
            endpointName: CSMONEY_LISTINGS_ENDPOINT_NAME,
            queueName: CSMONEY_SYNC_QUEUE_NAME,
            queueToken: CSMONEY_SYNC_QUEUE,
            classification: 'FRAGILE',
            behavior: {
              canDrivePrimaryTruth: true,
              canProvideFallbackPricing: true,
              canProvideQuantitySignals: true,
              canBeUsedForPairBuilding: true,
              canBeUsedForConfirmationOnly: true,
            },
            enabled: this.configService.isCSMoneyEnabled(),
            baseUrl: this.configService.csmoneyApiBaseUrl,
            currency: this.configService.csmoneyCurrency,
            pageLimit: this.configService.csmoneyPageLimit,
            batchSize: this.configService.csmoneyBatchSize,
            batchBudget: this.configService.csmoneyBatchBudget,
            rateLimitWindowSeconds:
              this.configService.csmoneyRateLimitWindowSeconds,
            rateLimitMaxRequests:
              this.configService.csmoneyRateLimitMaxRequests,
            retryAttempts: 2,
            retryBaseDelayMs: 1250,
            circuitBreakerFailureThreshold: 2,
            circuitBreakerCooldownSeconds: 420,
            targetQueryMode: 'hot-universe',
            requestPath: '/market/sell-orders',
            notes: [
              'CS.MONEY is treated as fragile and penalized in confidence-sensitive paths.',
              'Keep this adapter behind the feature flag unless the response contract is stable.',
            ],
          },
          this.configService.csmoneyApiKey,
        );
    }
  }

  private withOptionalApiKey(
    definition: Omit<ManagedMarketSourceDefinition, 'apiKey'>,
    apiKey: string | undefined,
  ): ManagedMarketSourceDefinition {
    return {
      ...definition,
      ...(apiKey ? { apiKey } : {}),
    };
  }
}
