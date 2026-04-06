import { randomUUID } from 'node:crypto';

import type { JobsOptions } from 'bullmq';

import type {
  SourceJobQueue,
  SourceJobRef,
} from '../../domain/source-job-queue.port';

export class NoopSourceJobQueue<Data> implements SourceJobQueue<Data> {
  add(name: string, data: Data, options?: JobsOptions): Promise<SourceJobRef> {
    void name;
    void data;
    void options;

    return Promise.resolve({
      id: randomUUID(),
    });
  }
}
