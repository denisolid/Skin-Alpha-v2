import { Inject, Injectable } from '@nestjs/common';

import { SOURCE_ADAPTERS } from '../../domain/source-adapter.constants';
import type { SourceAdapter } from '../../domain/source-adapter.interface';
import type { SourceAdapterKey } from '../../domain/source-adapter.types';

@Injectable()
export class SourceAdapterRegistry {
  private readonly adaptersByKey: ReadonlyMap<SourceAdapterKey, SourceAdapter>;

  constructor(
    @Inject(SOURCE_ADAPTERS)
    private readonly adapters: readonly SourceAdapter[],
  ) {
    const entries: ReadonlyArray<readonly [SourceAdapterKey, SourceAdapter]> =
      adapters.map((adapter): readonly [SourceAdapterKey, SourceAdapter] => [
        adapter.descriptor.key,
        adapter,
      ]);
    const uniqueKeys = new Set(entries.map(([key]) => key));

    if (uniqueKeys.size !== entries.length) {
      throw new Error('Duplicate source adapter keys are not allowed.');
    }

    this.adaptersByKey = new Map(entries);
  }

  list(): readonly SourceAdapter[] {
    return [...this.adapters].sort((left, right) => {
      const weightDifference =
        right.descriptor.priority.weight - left.descriptor.priority.weight;

      if (weightDifference !== 0) {
        return weightDifference;
      }

      return left.descriptor.displayName.localeCompare(
        right.descriptor.displayName,
      );
    });
  }

  get(source: SourceAdapterKey): SourceAdapter | undefined {
    return this.adaptersByKey.get(source);
  }

  getOrThrow(source: SourceAdapterKey): SourceAdapter {
    const adapter = this.get(source);

    if (!adapter) {
      throw new Error(`Source adapter "${source}" is not registered.`);
    }

    return adapter;
  }
}
