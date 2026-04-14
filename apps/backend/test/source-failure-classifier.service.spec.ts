import { IngestionFailureClass } from '@prisma/client';

import { SourceFailureClassifierService } from '../src/modules/source-adapters/services/source-failure-classifier.service';

describe('SourceFailureClassifierService', () => {
  const service = new SourceFailureClassifierService();

  it('classifies Prisma connection pool failures as db contention', () => {
    expect(
      service.classifyMessage(
        'Timed out fetching a new connection from the connection pool.',
      ),
    ).toBe(IngestionFailureClass.TIMEOUT);
  });

  it('classifies schema drift style errors as schema changed', () => {
    expect(
      service.classifyMessage('Unexpected payload shape for csfloat listings'),
    ).toBe(IngestionFailureClass.SCHEMA_CHANGED);
  });

  it('classifies rate limit errors as rate limited', () => {
    expect(service.classifyMessage('429 Too Many Requests')).toBe(
      IngestionFailureClass.RATE_LIMITED,
    );
  });
});
