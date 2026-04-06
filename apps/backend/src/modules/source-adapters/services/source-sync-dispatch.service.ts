import { Inject, Injectable } from '@nestjs/common';

import { AppLoggerService } from '../../../infrastructure/logging/app-logger.service';
import type { SourceAdapter } from '../domain/source-adapter.interface';
import type { SourceAdapterKey } from '../domain/source-adapter.types';
import type {
  SourceSyncAcceptedDto,
  SourceSyncBatchAcceptedDto,
  SourceSyncDispatchFailureDto,
} from '../dto/source-sync-accepted.dto';
import { SourceAdapterRegistry } from '../infrastructure/registry/source-adapter.registry';
import type { SourceSyncTrigger } from '../domain/source-adapter.types';

@Injectable()
export class SourceSyncDispatchService {
  constructor(
    @Inject(AppLoggerService)
    private readonly logger: AppLoggerService,
    @Inject(SourceAdapterRegistry)
    private readonly sourceAdapterRegistry: SourceAdapterRegistry,
  ) {}

  async dispatchManualSync(
    source: SourceAdapterKey,
  ): Promise<SourceSyncAcceptedDto> {
    return this.dispatchSync(source, 'manual');
  }

  async dispatchScheduledSync(
    source: SourceAdapterKey,
  ): Promise<SourceSyncAcceptedDto> {
    return this.dispatchSync(source, 'scheduled');
  }

  async dispatchManualSyncAll(): Promise<SourceSyncBatchAcceptedDto> {
    return this.dispatchSyncAll('manual');
  }

  private async dispatchSync(
    source: SourceAdapterKey,
    trigger: SourceSyncTrigger,
  ): Promise<SourceSyncAcceptedDto> {
    const requestedAt = new Date();
    const adapter = this.sourceAdapterRegistry.getOrThrow(source);
    const mode = this.selectDispatchMode(adapter);
    const result = await adapter.sync({
      trigger,
      mode,
      requestedAt,
    });
    this.logger.log(
      `Accepted ${trigger} sync for ${source} with ${result.acceptedJobs.length} queued job(s).`,
      SourceSyncDispatchService.name,
    );

    return {
      source: result.source,
      trigger: result.trigger,
      mode: result.mode,
      acceptedAt: requestedAt,
      acceptedJobs: result.acceptedJobs,
      warnings: result.warnings,
    };
  }

  private async dispatchSyncAll(
    trigger: SourceSyncTrigger,
  ): Promise<SourceSyncBatchAcceptedDto> {
    const requestedAt = new Date();
    const results: SourceSyncAcceptedDto[] = [];
    const failures: SourceSyncDispatchFailureDto[] = [];

    for (const adapter of this.sourceAdapterRegistry
      .list()
      .filter((candidate) => candidate.descriptor.priority.enabled)) {
      try {
        const mode = this.selectDispatchMode(adapter);
        const result = await adapter.sync({
          trigger,
          mode,
          requestedAt,
        });
        this.logger.log(
          `Accepted ${trigger} sync for ${adapter.descriptor.key} with ${result.acceptedJobs.length} queued job(s).`,
          SourceSyncDispatchService.name,
        );

        results.push({
          source: result.source,
          trigger: result.trigger,
          mode: result.mode,
          acceptedAt: requestedAt,
          acceptedJobs: result.acceptedJobs,
          warnings: result.warnings,
        });
      } catch (error) {
        this.logger.error(
          `Failed to accept manual sync for ${adapter.descriptor.key}: ${error instanceof Error ? error.message : 'Unknown sync error'}`,
          error instanceof Error ? error.stack : undefined,
          SourceSyncDispatchService.name,
        );
        failures.push({
          source: adapter.descriptor.key,
          error: error instanceof Error ? error.message : 'Unknown sync error',
        });
      }
    }

    return {
      requestedAt,
      acceptedSourceCount: results.length,
      acceptedJobCount: results.reduce(
        (total, result) => total + result.acceptedJobs.length,
        0,
      ),
      results,
      failures,
    };
  }

  private selectDispatchMode(
    adapter: SourceAdapter,
  ): SourceSyncAcceptedDto['mode'] {
    if (
      adapter.descriptor.capabilities.supportedSyncModes.includes(
        'full-snapshot',
      )
    ) {
      return 'full-snapshot';
    }

    return adapter.descriptor.capabilities.supportedSyncModes[0]!;
  }
}
