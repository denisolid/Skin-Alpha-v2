export interface OpportunityRescanJobData {
  readonly trigger: 'scheduled';
  readonly requestedAt: string;
  readonly externalJobId: string;
  readonly changedStateCount: number;
  readonly updatedHotItemCount: number;
}
