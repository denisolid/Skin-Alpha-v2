import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import type { AuthUserRecord } from '../../auth/domain/auth.repository';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { SessionAuthGuard } from '../../auth/guards/session-auth.guard';
import type { CatalogBootstrapResultDto } from '../../catalog/dto/catalog-bootstrap-result.dto';
import type { ScannerUniverseListDto } from '../../opportunities/dto/scanner-universe.dto';
import type {
  SourceSyncAcceptedDto,
  SourceSyncBatchAcceptedDto,
} from '../../source-adapters/dto/source-sync-accepted.dto';
import type { AdminBootstrapDevResponseDto } from '../dto/admin-bootstrap-dev-response.dto';
import type { AdminMarketStateRebuildResponseDto } from '../dto/admin-market-state-rebuild-response.dto';
import type { AdminOpportunitiesRescanResponseDto } from '../dto/admin-opportunities-rescan-response.dto';
import { AdminService } from '../services/admin.service';

@Controller('admin')
@UseGuards(SessionAuthGuard)
export class AdminController {
  constructor(
    @Inject(AdminService)
    private readonly adminService: AdminService,
  ) {}

  @Post('bootstrap/dev')
  bootstrapDev(
    @CurrentUser() user: AuthUserRecord,
  ): Promise<AdminBootstrapDevResponseDto> {
    return this.adminService.bootstrapDev(user);
  }

  @Post('catalog/bootstrap')
  bootstrapCatalog(
    @CurrentUser() user: AuthUserRecord,
  ): Promise<CatalogBootstrapResultDto> {
    return this.adminService.bootstrapCatalog(user);
  }

  @Post('opportunities/rescan')
  rescanOpportunities(
    @CurrentUser() user: AuthUserRecord,
    @Query('limit') limit?: string,
  ): Promise<AdminOpportunitiesRescanResponseDto> {
    return this.adminService.rescanOpportunities(
      user,
      this.parsePositiveLimit(limit),
    );
  }

  @Post('market-state/rebuild')
  rebuildMarketState(
    @CurrentUser() user: AuthUserRecord,
  ): Promise<AdminMarketStateRebuildResponseDto> {
    return this.adminService.rebuildMarketState(user);
  }

  @Post('sources/sync/skinport')
  syncSkinport(
    @CurrentUser() user: AuthUserRecord,
  ): Promise<SourceSyncAcceptedDto> {
    return this.adminService.syncSource(user, 'skinport');
  }

  @Post('sources/sync/csfloat')
  syncCsFloat(
    @CurrentUser() user: AuthUserRecord,
  ): Promise<SourceSyncAcceptedDto> {
    return this.adminService.syncSource(user, 'csfloat');
  }

  @Post('sources/sync/waxpeer')
  syncWaxpeer(
    @CurrentUser() user: AuthUserRecord,
  ): Promise<SourceSyncAcceptedDto> {
    return this.adminService.syncSource(user, 'waxpeer');
  }

  @Post('sources/sync/dmarket')
  syncDMarket(
    @CurrentUser() user: AuthUserRecord,
  ): Promise<SourceSyncAcceptedDto> {
    return this.adminService.syncSource(user, 'dmarket');
  }

  @Post('sources/sync/steam')
  syncSteam(
    @CurrentUser() user: AuthUserRecord,
  ): Promise<SourceSyncAcceptedDto> {
    return this.adminService.syncSource(user, 'steam-snapshot');
  }

  @Post('sources/sync/steam-snapshot')
  syncSteamSnapshot(
    @CurrentUser() user: AuthUserRecord,
  ): Promise<SourceSyncAcceptedDto> {
    return this.adminService.syncSource(user, 'steam-snapshot');
  }

  @Post('sources/sync/youpin')
  syncYouPin(
    @CurrentUser() user: AuthUserRecord,
  ): Promise<SourceSyncAcceptedDto> {
    return this.adminService.syncSource(user, 'youpin');
  }

  @Post('sources/sync/bitskins')
  syncBitSkins(
    @CurrentUser() user: AuthUserRecord,
  ): Promise<SourceSyncAcceptedDto> {
    return this.adminService.syncSource(user, 'bitskins');
  }

  @Post('sources/sync/c5game')
  syncC5Game(
    @CurrentUser() user: AuthUserRecord,
  ): Promise<SourceSyncAcceptedDto> {
    return this.adminService.syncSource(user, 'c5game');
  }

  @Post('sources/sync/csmoney')
  syncCSMoney(
    @CurrentUser() user: AuthUserRecord,
  ): Promise<SourceSyncAcceptedDto> {
    return this.adminService.syncSource(user, 'csmoney');
  }

  @Post('sources/sync/all')
  syncAllSources(
    @CurrentUser() user: AuthUserRecord,
  ): Promise<SourceSyncBatchAcceptedDto> {
    return this.adminService.syncAllSources(user);
  }

  @Get('scanner-universe/rebuild')
  rebuildScannerUniverse(
    @CurrentUser() user: AuthUserRecord,
  ): Promise<ScannerUniverseListDto> {
    return this.adminService.rebuildScannerUniverse(user);
  }

  private parsePositiveLimit(value: string | undefined): number | undefined {
    if (!value) {
      return undefined;
    }

    const parsed = Number.parseInt(value, 10);

    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new BadRequestException(
        'Query parameter "limit" must be a positive integer.',
      );
    }

    return parsed;
  }
}
