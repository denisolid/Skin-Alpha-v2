export interface AdminMarketStateRebuildResponseDto {
  readonly processedSnapshotCount: number;
  readonly rebuiltStateCount: number;
  readonly unchangedProjectionSkipCount: number;
}
