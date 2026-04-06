import type { SourceAdapterFrameworkDto } from '../dto/source-adapter-framework.dto';

export interface SourceAdaptersUseCase {
  getFramework(): Promise<SourceAdapterFrameworkDto>;
}
