import type { GetMarketSnapshotHistoryQueryDto } from '../dto/get-market-snapshot-history.query.dto';
import type { MarketSnapshotHistoryDto } from '../dto/market-snapshot-history.dto';
import type {
  CanonicalMarketMatrixDto,
  MergedMarketMatrixDto,
} from '../dto/merged-market-matrix.dto';
import type { MarketStateStatusDto } from '../dto/market-state-status.dto';

export interface MarketStateUseCase {
  getStatus(): MarketStateStatusDto;
  getVariantMatrix(itemVariantId: string): Promise<MergedMarketMatrixDto>;
  getCanonicalMatrix(
    canonicalItemId: string,
  ): Promise<CanonicalMarketMatrixDto>;
  getSnapshotHistory(
    itemVariantId: string,
    query?: GetMarketSnapshotHistoryQueryDto,
  ): Promise<MarketSnapshotHistoryDto>;
}
