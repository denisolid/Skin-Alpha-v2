import type {
  AuthSessionResponseDto,
  CurrentUserDto,
  EmailLoginDto,
  EmailRegisterDto,
  ExternalAuthUrlDto,
  GoogleCallbackQueryDto,
} from '../dto';
import type {
  AuthRequestMetadata,
  AuthSessionContext,
} from '../domain/auth.types';

export interface AuthUseCase {
  register(
    input: EmailRegisterDto,
    requestMetadata: AuthRequestMetadata,
  ): Promise<{
    response: AuthSessionResponseDto;
    sessionToken: string;
  }>;
  login(
    input: EmailLoginDto,
    requestMetadata: AuthRequestMetadata,
  ): Promise<{
    response: AuthSessionResponseDto;
    sessionToken: string;
  }>;
  refresh(
    sessionContext: AuthSessionContext,
    requestMetadata: AuthRequestMetadata,
  ): Promise<{
    response: AuthSessionResponseDto;
    sessionToken: string;
  }>;
  logout(sessionContext: AuthSessionContext): Promise<void>;
  getCurrentUser(sessionContext: AuthSessionContext): CurrentUserDto;
  getGoogleAuthorizationUrl(userId?: string): Promise<ExternalAuthUrlDto>;
  getSteamAuthorizationUrl(userId?: string): Promise<ExternalAuthUrlDto>;
  handleGoogleCallback(
    query: GoogleCallbackQueryDto,
    requestMetadata: AuthRequestMetadata,
  ): Promise<{
    redirectUrl: string;
    response: AuthSessionResponseDto;
    sessionToken: string;
  }>;
  handleSteamCallback(
    query: Record<string, unknown>,
    requestMetadata: AuthRequestMetadata,
  ): Promise<{
    redirectUrl: string;
    response: AuthSessionResponseDto;
    sessionToken: string;
  }>;
}
