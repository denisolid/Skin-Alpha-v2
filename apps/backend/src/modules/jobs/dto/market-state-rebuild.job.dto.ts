export interface MarketStateRebuildJobData {
  readonly trigger: 'scheduled';
  readonly requestedAt: string;
  readonly externalJobId: string;
}
