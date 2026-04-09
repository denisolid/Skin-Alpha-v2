import type { OpportunitiesStatusDto } from '../dto/opportunities-status.dto';
import type { GetOpportunityFeedQueryDto } from '../dto/get-opportunity-feed.query.dto';
import type {
  OpportunityDetailDto,
  OpportunityFullFeedPageDto,
  OpportunityPublicFeedPageDto,
  OpportunityRejectDiagnosticsPageDto,
} from '../dto/opportunity-feed.dto';
import type {
  GetOpportunityEngineQueryDto,
  GetVariantOpportunityEngineQueryDto,
} from '../dto/get-opportunity-engine.query.dto';
import type {
  OpportunityEngineScanResultDto,
  OpportunityEngineVariantResultDto,
} from '../dto/opportunity-engine.dto';
import type { GetScannerUniverseQueryDto } from '../dto/get-scanner-universe.query.dto';
import type {
  ScannerUniverseItemDto,
  ScannerUniverseListDto,
  ScannerUniverseOverrideMutationDto,
} from '../dto/scanner-universe.dto';
import type { SetHotUniverseOverrideDto } from '../dto/set-hot-universe-override.dto';
import type { AuthUserRecord } from '../../auth/domain/auth.repository';

export interface OpportunitiesUseCase {
  getStatus(): OpportunitiesStatusDto;
  evaluateScannerUniverse(
    query?: GetOpportunityEngineQueryDto,
  ): Promise<OpportunityEngineScanResultDto>;
  evaluateVariantOpportunities(
    itemVariantId: string,
    query?: GetVariantOpportunityEngineQueryDto,
  ): Promise<OpportunityEngineVariantResultDto>;
  getPublicFeed(
    query?: GetOpportunityFeedQueryDto,
  ): Promise<OpportunityPublicFeedPageDto>;
  getFullFeed(
    query?: GetOpportunityFeedQueryDto,
  ): Promise<OpportunityFullFeedPageDto>;
  getOpportunityDetail(
    opportunityKey: string,
  ): Promise<OpportunityDetailDto>;
  getRejectDiagnostics(
    query: GetOpportunityFeedQueryDto | undefined,
    user: Pick<AuthUserRecord, 'role'>,
  ): Promise<OpportunityRejectDiagnosticsPageDto>;
  getScannerUniverse(
    query?: GetScannerUniverseQueryDto,
  ): Promise<ScannerUniverseListDto>;
  getScannerUniverseItem(
    itemVariantId: string,
  ): Promise<ScannerUniverseItemDto>;
  setHotOverride(
    itemVariantId: string,
    input: SetHotUniverseOverrideDto,
    user: Pick<AuthUserRecord, 'id' | 'role'>,
  ): Promise<ScannerUniverseOverrideMutationDto>;
  clearHotOverride(
    itemVariantId: string,
    user: Pick<AuthUserRecord, 'id' | 'role'>,
  ): Promise<ScannerUniverseOverrideMutationDto>;
}
