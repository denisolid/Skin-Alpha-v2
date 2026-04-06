import { Controller, Get, Inject } from '@nestjs/common';

import type { SourceAdapterFrameworkDto } from '../dto/source-adapter-framework.dto';
import { SourceAdaptersService } from '../services/source-adapters.service';

@Controller('source-adapters')
export class SourceAdaptersController {
  constructor(
    @Inject(SourceAdaptersService)
    private readonly sourceAdaptersService: SourceAdaptersService,
  ) {}

  @Get()
  getFramework(): Promise<SourceAdapterFrameworkDto> {
    return this.sourceAdaptersService.getFramework();
  }
}
