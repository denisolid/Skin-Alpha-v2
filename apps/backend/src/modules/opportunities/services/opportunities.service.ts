import { Inject, Injectable } from '@nestjs/common';

import type { AuthUserRecord } from '../../auth/domain/auth.repository';
import type { OpportunitiesUseCase } from '../application/opportunities.use-case';
import type {
  GetOpportunityDetailQueryDto,
  GetOpportunityFeedQueryDto,
} from '../dto/get-opportunity-feed.query.dto';
import type {
  OpportunityDetailDto,
  OpportunityFullFeedPageDto,
  OpportunityPublicFeedPageDto,
  OpportunityRejectDiagnosticsPageDto,
} from '../dto/opportunity-feed.dto';
import type {
  GetOpportunityEngineQueryDto as GetOpportunityEngineInputDto,
  GetVariantOpportunityEngineQueryDto,
} from '../dto/get-opportunity-engine.query.dto';
import type { GetScannerUniverseQueryDto } from '../dto/get-scanner-universe.query.dto';
import type {
  OpportunityEngineScanResultDto,
  OpportunityEngineVariantResultDto,
} from '../dto/opportunity-engine.dto';
import { OpportunitiesStatusDto } from '../dto/opportunities-status.dto';
import type {
  ScannerUniverseItemDto,
  ScannerUniverseListDto,
  ScannerUniverseOverrideMutationDto,
} from '../dto/scanner-universe.dto';
import type { SetHotUniverseOverrideDto } from '../dto/set-hot-universe-override.dto';
import { OpportunityFeedService } from './opportunity-feed.service';
import { OpportunityEngineService } from './opportunity-engine.service';
import { ScannerUniverseService } from './scanner-universe.service';

@Injectable()
export class OpportunitiesService implements OpportunitiesUseCase {
  constructor(
    @Inject(OpportunityEngineService)
    private readonly opportunityEngineService: OpportunityEngineService,
    @Inject(OpportunityFeedService)
    private readonly opportunityFeedService: OpportunityFeedService,
    @Inject(ScannerUniverseService)
    private readonly scannerUniverseService: ScannerUniverseService,
  ) {}

  getStatus(): OpportunitiesStatusDto {
    return new OpportunitiesStatusDto();
  }

  evaluateScannerUniverse(
    query?: GetOpportunityEngineInputDto,
  ): Promise<OpportunityEngineScanResultDto> {
    return this.opportunityEngineService.evaluateScannerUniverse(query);
  }

  evaluateVariantOpportunities(
    itemVariantId: string,
    query?: GetVariantOpportunityEngineQueryDto,
  ): Promise<OpportunityEngineVariantResultDto> {
    return this.opportunityEngineService.evaluateVariant(itemVariantId, query);
  }

  getPublicFeed(
    query?: GetOpportunityFeedQueryDto,
  ): Promise<OpportunityPublicFeedPageDto> {
    return this.opportunityFeedService.getPublicFeed(query);
  }

  getFullFeed(
    query?: GetOpportunityFeedQueryDto,
  ): Promise<OpportunityFullFeedPageDto> {
    return this.opportunityFeedService.getFullFeed(query);
  }

  getOpportunityDetail(
    itemVariantId: string,
    query: GetOpportunityDetailQueryDto,
  ): Promise<OpportunityDetailDto> {
    return this.opportunityFeedService.getOpportunityDetail(
      itemVariantId,
      query,
    );
  }

  getRejectDiagnostics(
    query: GetOpportunityFeedQueryDto | undefined,
    user: Pick<AuthUserRecord, 'role'>,
  ): Promise<OpportunityRejectDiagnosticsPageDto> {
    return this.opportunityFeedService.getRejectDiagnostics(query, user);
  }

  getScannerUniverse(
    query?: GetScannerUniverseQueryDto,
  ): Promise<ScannerUniverseListDto> {
    return this.scannerUniverseService.getScannerUniverse(query);
  }

  getScannerUniverseItem(
    itemVariantId: string,
  ): Promise<ScannerUniverseItemDto> {
    return this.scannerUniverseService.getScannerUniverseItem(itemVariantId);
  }

  setHotOverride(
    itemVariantId: string,
    input: SetHotUniverseOverrideDto,
    user: Pick<AuthUserRecord, 'id' | 'role'>,
  ): Promise<ScannerUniverseOverrideMutationDto> {
    return this.scannerUniverseService.setHotOverride(
      itemVariantId,
      input,
      user,
    );
  }

  clearHotOverride(
    itemVariantId: string,
    user: Pick<AuthUserRecord, 'id' | 'role'>,
  ): Promise<ScannerUniverseOverrideMutationDto> {
    return this.scannerUniverseService.clearHotOverride(itemVariantId, user);
  }
}
