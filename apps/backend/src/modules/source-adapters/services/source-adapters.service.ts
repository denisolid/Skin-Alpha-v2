import { Inject, Injectable } from '@nestjs/common';

import type { SourceAdaptersUseCase } from '../application/source-adapters.use-case';
import type { SourceSchedulerContract } from '../application/source-scheduler.contract';
import { SOURCE_SCHEDULER } from '../domain/source-adapter.constants';
import type { SourceAdapterFrameworkDto } from '../dto/source-adapter-framework.dto';
import type { SourceAdapterSummaryDto } from '../dto/source-adapter-summary.dto';
import { SourceAdapterRegistry } from '../infrastructure/registry/source-adapter.registry';

@Injectable()
export class SourceAdaptersService implements SourceAdaptersUseCase {
  constructor(
    @Inject(SourceAdapterRegistry)
    private readonly sourceAdapterRegistry: SourceAdapterRegistry,
    @Inject(SOURCE_SCHEDULER)
    private readonly sourceScheduler: SourceSchedulerContract,
  ) {}

  async getFramework(): Promise<SourceAdapterFrameworkDto> {
    const requestedAt = new Date();
    const adapters = this.sourceAdapterRegistry.list();
    const summaries = await Promise.all(
      adapters.map(async (adapter): Promise<SourceAdapterSummaryDto> => {
        const [health, rateLimitState] = await Promise.all([
          adapter.getHealth(),
          adapter.getRateLimitState(),
        ]);

        const schedule = await this.sourceScheduler.decide({
          adapter: adapter.descriptor,
          health,
          rateLimitState,
          trigger: 'scheduled',
          requestedAt,
        });

        return {
          source: adapter.descriptor.key,
          displayName: adapter.descriptor.displayName,
          category: adapter.descriptor.category,
          classification: adapter.descriptor.classification,
          behavior: adapter.descriptor.behavior,
          capabilities: adapter.descriptor.capabilities,
          priority: adapter.descriptor.priority,
          health,
          rateLimitState,
          schedule,
        };
      }),
    );

    return {
      generatedAt: requestedAt,
      adapters: summaries,
    };
  }
}
