import { Module } from '@nestjs/common';

import { CatalogController } from './controllers/catalog.controller';
import { CATALOG_REPOSITORY } from './domain/catalog.repository';
import { CatalogRepositoryAdapter } from './infrastructure/catalog.repository';
import { CatalogAliasNormalizationService } from './services/catalog-alias-normalization.service';
import { CatalogBootstrapService } from './services/catalog-bootstrap.service';
import { CatalogMappingService } from './services/catalog-mapping.service';
import { CatalogService } from './services/catalog.service';

@Module({
  controllers: [CatalogController],
  providers: [
    CatalogService,
    CatalogBootstrapService,
    CatalogAliasNormalizationService,
    CatalogMappingService,
    {
      provide: CATALOG_REPOSITORY,
      useClass: CatalogRepositoryAdapter,
    },
  ],
  exports: [CatalogService, CatalogBootstrapService],
})
export class CatalogModule {}
