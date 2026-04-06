import type { JobsOptions } from 'bullmq';

export interface JobsQueueRef {
  readonly id?: string;
}

export interface JobsQueue<Data> {
  add(name: string, data: Data, options?: JobsOptions): Promise<JobsQueueRef>;
}
