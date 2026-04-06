import { randomUUID } from 'node:crypto';

import type { JobsOptions } from 'bullmq';

import type { JobsQueue, JobsQueueRef } from '../../domain/jobs-queue.port';

export class NoopJobsQueue<Data> implements JobsQueue<Data> {
  add(name: string, data: Data, options?: JobsOptions): Promise<JobsQueueRef> {
    void name;
    void data;
    void options;

    return Promise.resolve({
      id: randomUUID(),
    });
  }
}
