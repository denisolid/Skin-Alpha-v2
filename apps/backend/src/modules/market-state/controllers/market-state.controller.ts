import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';

import { GetMarketSnapshotHistoryQueryDto } from '../dto/get-market-snapshot-history.query.dto';
import type { MarketSnapshotHistoryDto } from '../dto/market-snapshot-history.dto';
import type {
  CanonicalMarketMatrixDto,
  MergedMarketMatrixDto,
} from '../dto/merged-market-matrix.dto';
import { MarketStateStatusDto } from '../dto/market-state-status.dto';
import { MarketStateService } from '../services/market-state.service';

@Controller('market-state')
export class MarketStateController {
  constructor(
    @Inject(MarketStateService)
    private readonly marketStateService: MarketStateService,
  ) {}

  @Get()
  getStatus(): MarketStateStatusDto {
    return this.marketStateService.getStatus();
  }

  @Get('variants/:itemVariantId/matrix')
  getVariantMatrix(
    @Param('itemVariantId', new ParseUUIDPipe({ version: '4' }))
    itemVariantId: string,
  ): Promise<MergedMarketMatrixDto> {
    return this.marketStateService.getVariantMatrix(itemVariantId);
  }

  @Get('canonical-items/:canonicalItemId/matrix')
  getCanonicalMatrix(
    @Param('canonicalItemId', new ParseUUIDPipe({ version: '4' }))
    canonicalItemId: string,
  ): Promise<CanonicalMarketMatrixDto> {
    return this.marketStateService.getCanonicalMatrix(canonicalItemId);
  }

  @Get('variants/:itemVariantId/snapshots')
  getSnapshotHistory(
    @Param('itemVariantId', new ParseUUIDPipe({ version: '4' }))
    itemVariantId: string,
    @Query() query: GetMarketSnapshotHistoryQueryDto,
  ): Promise<MarketSnapshotHistoryDto> {
    return this.marketStateService.getSnapshotHistory(itemVariantId, query);
  }
}
