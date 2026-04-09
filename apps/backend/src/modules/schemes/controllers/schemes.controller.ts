import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import type { AuthUserRecord } from '../../auth/domain/auth.repository';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { SessionAuthGuard } from '../../auth/guards/session-auth.guard';
import { CreateSchemeDto } from '../dto/create-scheme.dto';
import { DuplicateSchemeDto } from '../dto/duplicate-scheme.dto';
import type {
  SchemeDetailDto,
  SchemesListDto,
} from '../dto/scheme.dto';
import { UpdateSchemeDto } from '../dto/update-scheme.dto';
import { SchemesService } from '../services/schemes.service';

@Controller('schemes')
@UseGuards(SessionAuthGuard)
export class SchemesController {
  constructor(
    @Inject(SchemesService)
    private readonly schemesService: SchemesService,
  ) {}

  @Get()
  getSchemes(@CurrentUser() user: AuthUserRecord): Promise<SchemesListDto> {
    return this.schemesService.getSchemes(user);
  }

  @Get(':schemeId')
  getScheme(
    @Param('schemeId', new ParseUUIDPipe({ version: '4' })) schemeId: string,
    @CurrentUser() user: AuthUserRecord,
  ): Promise<SchemeDetailDto> {
    return this.schemesService.getScheme(schemeId, user);
  }

  @Post()
  createScheme(
    @Body() body: CreateSchemeDto,
    @CurrentUser() user: AuthUserRecord,
  ): Promise<SchemeDetailDto> {
    return this.schemesService.createScheme(body, user);
  }

  @Patch(':schemeId')
  updateScheme(
    @Param('schemeId', new ParseUUIDPipe({ version: '4' })) schemeId: string,
    @Body() body: UpdateSchemeDto,
    @CurrentUser() user: AuthUserRecord,
  ): Promise<SchemeDetailDto> {
    return this.schemesService.updateScheme(schemeId, body, user);
  }

  @Post(':schemeId/activate')
  activateScheme(
    @Param('schemeId', new ParseUUIDPipe({ version: '4' })) schemeId: string,
    @CurrentUser() user: AuthUserRecord,
  ): Promise<SchemeDetailDto> {
    return this.schemesService.activateScheme(schemeId, user);
  }

  @Post(':schemeId/deactivate')
  deactivateScheme(
    @Param('schemeId', new ParseUUIDPipe({ version: '4' })) schemeId: string,
    @CurrentUser() user: AuthUserRecord,
  ): Promise<SchemeDetailDto> {
    return this.schemesService.deactivateScheme(schemeId, user);
  }

  @Post(':schemeId/duplicate')
  duplicateScheme(
    @Param('schemeId', new ParseUUIDPipe({ version: '4' })) schemeId: string,
    @Body() body: DuplicateSchemeDto,
    @CurrentUser() user: AuthUserRecord,
  ): Promise<SchemeDetailDto> {
    return this.schemesService.duplicateScheme(schemeId, body, user);
  }

  @Delete(':schemeId')
  async archiveScheme(
    @Param('schemeId', new ParseUUIDPipe({ version: '4' })) schemeId: string,
    @CurrentUser() user: AuthUserRecord,
  ): Promise<void> {
    await this.schemesService.archiveScheme(schemeId, user);
  }
}
