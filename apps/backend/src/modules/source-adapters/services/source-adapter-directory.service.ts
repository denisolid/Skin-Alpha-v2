import { Inject, Injectable } from '@nestjs/common';

import type { SourceAdapterDescriptor } from '../domain/source-adapter.interface';
import type { SourceAdapterKey } from '../domain/source-adapter.types';
import { SourceAdapterRegistry } from '../infrastructure/registry/source-adapter.registry';

@Injectable()
export class SourceAdapterDirectoryService {
  constructor(
    @Inject(SourceAdapterRegistry)
    private readonly sourceAdapterRegistry: SourceAdapterRegistry,
  ) {}

  listDescriptors(): readonly SourceAdapterDescriptor[] {
    return this.sourceAdapterRegistry
      .list()
      .map((adapter) => adapter.descriptor);
  }

  getDescriptor(source: SourceAdapterKey): SourceAdapterDescriptor | undefined {
    return this.sourceAdapterRegistry.get(source)?.descriptor;
  }
}
