import { Inject, Injectable } from '@nestjs/common';

import type { MarketStateUseCase } from '../application/market-state.use-case';
import type { GetMarketSnapshotHistoryQueryDto } from '../dto/get-market-snapshot-history.query.dto';
import type { MarketSnapshotHistoryDto } from '../dto/market-snapshot-history.dto';
import type {
  CanonicalMarketMatrixDto,
  MergedMarketMatrixDto,
} from '../dto/merged-market-matrix.dto';
import { MarketStateStatusDto } from '../dto/market-state-status.dto';
import { MarketSnapshotService } from './market-snapshot.service';
import { MarketStateMergeService } from './market-state-merge.service';

@Injectable()
export class MarketStateService implements MarketStateUseCase {
  constructor(
    @Inject(MarketStateMergeService)
    private readonly marketStateMergeService: MarketStateMergeService,
    @Inject(MarketSnapshotService)
    private readonly marketSnapshotService: MarketSnapshotService,
  ) {}

  getStatus(): MarketStateStatusDto {
    return new MarketStateStatusDto();
  }

  getVariantMatrix(itemVariantId: string): Promise<MergedMarketMatrixDto> {
    return this.marketStateMergeService.getVariantMatrix(itemVariantId);
  }

  getCanonicalMatrix(
    canonicalItemId: string,
  ): Promise<CanonicalMarketMatrixDto> {
    return this.marketStateMergeService.getCanonicalMatrix(canonicalItemId);
  }

  getSnapshotHistory(
    itemVariantId: string,
    query?: GetMarketSnapshotHistoryQueryDto,
  ): Promise<MarketSnapshotHistoryDto> {
    return this.marketSnapshotService.getSnapshotHistory(
      itemVariantId,
      query?.limit,
    );
  }
}
