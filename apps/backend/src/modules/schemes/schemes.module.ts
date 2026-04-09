import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { SchemesController } from './controllers/schemes.controller';
import { SCHEMES_REPOSITORY } from './domain/schemes.repository';
import { SchemesRepositoryAdapter } from './infrastructure/schemes.repository';
import { SchemeCompilerService } from './services/scheme-compiler.service';
import { SchemesService } from './services/schemes.service';

@Module({
  imports: [AuthModule, SubscriptionsModule],
  controllers: [SchemesController],
  providers: [
    SchemesService,
    SchemeCompilerService,
    {
      provide: SCHEMES_REPOSITORY,
      useClass: SchemesRepositoryAdapter,
    },
  ],
  exports: [SchemesService, SchemeCompilerService],
})
export class SchemesModule {}
