import type { AuthUserRecord } from '../../auth/domain/auth.repository';
import type { CreateSchemeDto } from '../dto/create-scheme.dto';
import type { DuplicateSchemeDto } from '../dto/duplicate-scheme.dto';
import type {
  SchemeDetailDto,
  SchemesListDto,
} from '../dto/scheme.dto';
import type { UpdateSchemeDto } from '../dto/update-scheme.dto';

export interface SchemesUseCase {
  getSchemes(user: Pick<AuthUserRecord, 'id'>): Promise<SchemesListDto>;
  getScheme(
    schemeId: string,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<SchemeDetailDto>;
  createScheme(
    input: CreateSchemeDto,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<SchemeDetailDto>;
  updateScheme(
    schemeId: string,
    input: UpdateSchemeDto,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<SchemeDetailDto>;
  activateScheme(
    schemeId: string,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<SchemeDetailDto>;
  deactivateScheme(
    schemeId: string,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<SchemeDetailDto>;
  archiveScheme(
    schemeId: string,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<void>;
  duplicateScheme(
    schemeId: string,
    input: DuplicateSchemeDto | undefined,
    user: Pick<AuthUserRecord, 'id'>,
  ): Promise<SchemeDetailDto>;
}
