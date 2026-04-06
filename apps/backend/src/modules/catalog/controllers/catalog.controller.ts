import { Controller, Get, Inject } from '@nestjs/common';

import { CatalogStatusDto } from '../dto/catalog-status.dto';
import { CatalogService } from '../services/catalog.service';

@Controller('catalog')
export class CatalogController {
  constructor(
    @Inject(CatalogService) private readonly catalogService: CatalogService,
  ) {}

  @Get()
  getStatus(): CatalogStatusDto {
    return this.catalogService.getStatus();
  }
}
