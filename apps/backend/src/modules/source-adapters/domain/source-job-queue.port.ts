import type { JobsOptions } from 'bullmq';

export interface SourceJobRef {
  readonly id?: string;
}

export interface SourceJobQueue<Data> {
  add(name: string, data: Data, options?: JobsOptions): Promise<SourceJobRef>;
}
