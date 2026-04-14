export interface MarketStateRebuildResultDto {
  readonly processedSnapshotCount: number;
  readonly rebuiltStateCount: number;
  readonly unchangedProjectionSkipCount: number;
}
