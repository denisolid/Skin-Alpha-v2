import { Inject, Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../infrastructure/config/app-config.service';
import type {
  SourceOperationalProfileModel,
  SourceOperationalSourceKey,
} from '../domain/source-operational-profile.model';

@Injectable()
export class SourceOperationalProfileService {
  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
  ) {}

  get(source: SourceOperationalSourceKey): SourceOperationalProfileModel {
    switch (source) {
      case 'skinport':
        return {
          key: source,
          displayName: 'Skinport',
          integrationModel: 'official-public-api',
          stage: 'active',
          riskTier: 'low',
          proxyRequirement: 'none',
          sessionRequirement: 'none',
          accountRequirement: 'none',
          cookieRequirement: 'none',
          regionAffinity: 'global',
          overlapPriorityWeight: 1.2,
          pairBuildingWeight: 1.2,
          autoDisableEligible: true,
          notes: ['Stable cached public marketplace feed.'],
        };
      case 'csfloat':
        return {
          key: source,
          displayName: 'CSFloat',
          integrationModel: 'official-api',
          stage: 'active',
          riskTier: 'low',
          proxyRequirement: 'none',
          sessionRequirement: 'none',
          accountRequirement: 'none',
          cookieRequirement: 'none',
          regionAffinity: 'global',
          overlapPriorityWeight: 1.35,
          pairBuildingWeight: 1.4,
          autoDisableEligible: true,
          notes: ['Primary precise-identity source for float and paint seed coverage.'],
        };
      case 'dmarket':
        return {
          key: source,
          displayName: 'DMarket',
          integrationModel: 'signed-official-api',
          stage: this.configService.isDMarketEnabled() ? 'active' : 'limited',
          riskTier: 'low',
          proxyRequirement: 'none',
          sessionRequirement: 'none',
          accountRequirement: 'none',
          cookieRequirement: 'none',
          regionAffinity: 'global',
          overlapPriorityWeight: 1.15,
          pairBuildingWeight: 1.15,
          autoDisableEligible: true,
          notes: ['Signed official API with bounded overlap-first ingestion.'],
        };
      case 'waxpeer':
        return {
          key: source,
          displayName: 'Waxpeer',
          integrationModel: 'official-public-api',
          stage: this.configService.isWaxpeerEnabled() ? 'active' : 'limited',
          riskTier: 'medium',
          proxyRequirement: 'none',
          sessionRequirement: 'none',
          accountRequirement: 'none',
          cookieRequirement: 'none',
          regionAffinity: 'global',
          overlapPriorityWeight: 1.05,
          pairBuildingWeight: 1.05,
          autoDisableEligible: true,
          notes: ['Official public mass-info integration; aggregate identity source.'],
        };
      case 'bitskins':
        return {
          key: source,
          displayName: 'BitSkins',
          integrationModel: 'official-public-api',
          stage: this.configService.isBitSkinsEnabled() ? 'active' : 'limited',
          riskTier: 'medium',
          proxyRequirement: 'none',
          sessionRequirement: 'none',
          accountRequirement: 'none',
          cookieRequirement: 'none',
          regionAffinity: 'global',
          overlapPriorityWeight: 1,
          pairBuildingWeight: 1,
          autoDisableEligible: true,
          notes: ['Bounded target-filtered full snapshot from current public API surface.'],
        };
      case 'steam-snapshot':
        return {
          key: source,
          displayName: 'Steam Snapshot',
          integrationModel: 'official-snapshot',
          stage: this.configService.isSteamSnapshotEnabled() ? 'active' : 'limited',
          riskTier: 'low',
          proxyRequirement: 'none',
          sessionRequirement: 'none',
          accountRequirement: 'none',
          cookieRequirement: 'none',
          regionAffinity: 'global',
          overlapPriorityWeight: 0.7,
          pairBuildingWeight: 0.6,
          autoDisableEligible: true,
          notes: ['Reference/snapshot source; keep penalties on sell-leg tradability.'],
        };
      case 'backup-aggregator':
        return {
          key: source,
          displayName: 'Backup Aggregator',
          integrationModel: 'internal-aggregator',
          stage: this.configService.isBackupAggregatorEnabled() ? 'active' : 'limited',
          riskTier: 'medium',
          proxyRequirement: 'none',
          sessionRequirement: 'none',
          accountRequirement: 'none',
          cookieRequirement: 'none',
          regionAffinity: 'global',
          overlapPriorityWeight: 0.45,
          pairBuildingWeight: 0.2,
          autoDisableEligible: false,
          notes: ['Confirmation/reference only; never let this drive primary pairability.'],
        };
      case 'youpin':
        return {
          key: source,
          displayName: 'YouPin',
          integrationModel: 'open-platform-api',
          stage: this.configService.isYouPinPrimaryTruthEnabled() ? 'limited' : 'prep',
          riskTier: 'high',
          proxyRequirement: 'required',
          sessionRequirement: 'required',
          accountRequirement: 'required',
          cookieRequirement: 'required',
          regionAffinity: 'cn-mainland',
          overlapPriorityWeight: 0.95,
          pairBuildingWeight: this.configService.isYouPinPrimaryTruthEnabled()
            ? 0.95
            : 0.35,
          autoDisableEligible: true,
          notes: [
            'Requires source-operations readiness before broad rollout.',
            'Treat as reference-only until stable session and anti-ban controls exist.',
          ],
        };
      case 'c5game':
        return {
          key: source,
          displayName: 'C5Game',
          integrationModel: 'partner-api',
          stage: this.configService.isC5GameEnabled() ? 'limited' : 'prep',
          riskTier: 'high',
          proxyRequirement: 'optional',
          sessionRequirement: 'optional',
          accountRequirement: 'required',
          cookieRequirement: 'optional',
          regionAffinity: 'cn-mainland',
          overlapPriorityWeight: 0.9,
          pairBuildingWeight: 0.85,
          autoDisableEligible: true,
          notes: [
            'Enable only behind explicit partner/open-access prerequisites.',
            'Do not run as a healthy-source peer until account-level recovery exists.',
          ],
        };
      case 'csmoney':
        return {
          key: source,
          displayName: 'CS.MONEY',
          integrationModel: 'session-web',
          stage: this.configService.isCSMoneyEnabled() ? 'limited' : 'prep',
          riskTier: 'high',
          proxyRequirement: 'required',
          sessionRequirement: 'required',
          accountRequirement: 'optional',
          cookieRequirement: 'required',
          regionAffinity: 'global',
          overlapPriorityWeight: 0.75,
          pairBuildingWeight: 0.7,
          autoDisableEligible: true,
          notes: ['Fragile web/session integration; keep penalized and auto-disablable.'],
        };
      case 'buff163':
        return {
          key: source,
          displayName: 'BUFF163',
          integrationModel: 'reverse-engineered-session',
          stage: 'prep',
          riskTier: 'extreme',
          proxyRequirement: 'required',
          sessionRequirement: 'required',
          accountRequirement: 'required',
          cookieRequirement: 'required',
          regionAffinity: 'cn-mainland',
          overlapPriorityWeight: 0.8,
          pairBuildingWeight: 0.6,
          autoDisableEligible: true,
          notes: [
            'Preparation-only until proxy, session, account, and recovery controls are proven.',
            'No production ingestion should start from the current healthy-source runtime.',
          ],
        };
    }
  }

  toMetadataFragment(source: SourceOperationalSourceKey): Record<string, unknown> {
    const profile = this.get(source);

    return {
      operational: {
        integrationModel: profile.integrationModel,
        stage: profile.stage,
        riskTier: profile.riskTier,
        proxyRequirement: profile.proxyRequirement,
        sessionRequirement: profile.sessionRequirement,
        accountRequirement: profile.accountRequirement,
        cookieRequirement: profile.cookieRequirement,
        regionAffinity: profile.regionAffinity,
        overlapPriorityWeight: profile.overlapPriorityWeight,
        pairBuildingWeight: profile.pairBuildingWeight,
        autoDisableEligible: profile.autoDisableEligible,
      },
      operationalNotes: [...profile.notes],
    };
  }
}
