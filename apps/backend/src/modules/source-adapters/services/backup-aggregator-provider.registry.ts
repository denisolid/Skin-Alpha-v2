import { Inject, Injectable } from '@nestjs/common';

import { BACKUP_REFERENCE_PROVIDERS } from '../domain/backup-aggregator.constants';
import type {
  BackupReferenceProvider,
  BackupReferenceProviderKey,
} from '../domain/backup-reference-provider.interface';

@Injectable()
export class BackupAggregatorProviderRegistry {
  private readonly providersByKey: ReadonlyMap<
    BackupReferenceProviderKey,
    BackupReferenceProvider
  >;

  constructor(
    @Inject(BACKUP_REFERENCE_PROVIDERS)
    private readonly providers: readonly BackupReferenceProvider[],
  ) {
    const entries = providers.map(
      (
        provider,
      ): readonly [BackupReferenceProviderKey, BackupReferenceProvider] => [
        provider.descriptor.key,
        provider,
      ],
    );

    this.providersByKey = new Map(entries);
  }

  list(): readonly BackupReferenceProvider[] {
    return [...this.providers].sort(
      (left, right) => right.descriptor.priority - left.descriptor.priority,
    );
  }

  listEnabled(
    providerKeys?: readonly BackupReferenceProviderKey[],
  ): readonly BackupReferenceProvider[] {
    const requestedKeys = providerKeys ? new Set(providerKeys) : null;

    return this.list().filter(
      (provider) =>
        provider.isEnabled() &&
        (!requestedKeys || requestedKeys.has(provider.descriptor.key)),
    );
  }

  get(
    providerKey: BackupReferenceProviderKey,
  ): BackupReferenceProvider | undefined {
    return this.providersByKey.get(providerKey);
  }
}
