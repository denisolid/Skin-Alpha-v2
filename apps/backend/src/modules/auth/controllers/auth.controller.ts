import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { CurrentUser } from '../decorators/current-user.decorator';
import type { AuthUserRecord } from '../domain/auth.repository';
import {
  AuthSessionResponseDto,
  CurrentUserDto,
  EmailLoginDto,
  EmailRegisterDto,
  ExternalAuthUrlDto,
  GoogleCallbackQueryDto,
} from '../dto';
import { SessionAuthGuard } from '../guards/session-auth.guard';
import type { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';
import { AuthService } from '../services/auth.service';
import { SessionCookieService } from '../services/session-cookie.service';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService)
    private readonly authService: AuthService,
    @Inject(SessionCookieService)
    private readonly sessionCookieService: SessionCookieService,
  ) {}

  @Post('register')
  async register(
    @Body() input: EmailRegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponseDto> {
    const result = await this.authService.register(
      input,
      this.extractRequestMetadata(request),
    );

    this.sessionCookieService.setSessionCookie(
      response,
      result.sessionToken,
      result.response.session.expiresAt,
    );

    return result.response;
  }

  @Post('login')
  async login(
    @Body() input: EmailLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponseDto> {
    const result = await this.authService.login(
      input,
      this.extractRequestMetadata(request),
    );

    this.sessionCookieService.setSessionCookie(
      response,
      result.sessionToken,
      result.response.session.expiresAt,
    );

    return result.response;
  }

  @Post('refresh')
  @UseGuards(SessionAuthGuard)
  async refresh(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponseDto> {
    const result = await this.authService.refresh(
      request.auth!,
      this.extractRequestMetadata(request),
    );

    this.sessionCookieService.setSessionCookie(
      response,
      result.sessionToken,
      result.response.session.expiresAt,
    );

    return result.response;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionAuthGuard)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.logout(request.auth!);
    this.sessionCookieService.clearSessionCookie(response);
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  getCurrentUser(@Req() request: AuthenticatedRequest): CurrentUserDto {
    return this.authService.getCurrentUser(request.auth!);
  }

  @Get('google/start')
  getGoogleAuthorizationUrl(): Promise<ExternalAuthUrlDto> {
    return this.authService.getGoogleAuthorizationUrl();
  }

  @Get('google/link/start')
  @UseGuards(SessionAuthGuard)
  getGoogleLinkAuthorizationUrl(
    @CurrentUser() user: AuthUserRecord,
  ): Promise<ExternalAuthUrlDto> {
    return this.authService.getGoogleAuthorizationUrl(user.id);
  }

  @Get('google/callback')
  async handleGoogleCallback(
    @Query() query: GoogleCallbackQueryDto,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    try {
      const result = await this.authService.handleGoogleCallback(
        query,
        this.extractRequestMetadata(request),
      );

      this.sessionCookieService.setSessionCookie(
        response,
        result.sessionToken,
        result.response.session.expiresAt,
      );

      response.redirect(result.redirectUrl);
    } catch (error) {
      this.sessionCookieService.clearSessionCookie(response);
      response.redirect(
        this.authService.buildExternalAuthErrorRedirect('google', error),
      );
    }
  }

  @Get('steam/start')
  getSteamAuthorizationUrl(): Promise<ExternalAuthUrlDto> {
    return this.authService.getSteamAuthorizationUrl();
  }

  @Get('steam/link/start')
  @UseGuards(SessionAuthGuard)
  getSteamLinkAuthorizationUrl(
    @CurrentUser() user: AuthUserRecord,
  ): Promise<ExternalAuthUrlDto> {
    return this.authService.getSteamAuthorizationUrl(user.id);
  }

  @Get('steam/callback')
  async handleSteamCallback(
    @Query() query: Record<string, unknown>,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    try {
      const result = await this.authService.handleSteamCallback(
        query,
        this.extractRequestMetadata(request),
      );

      this.sessionCookieService.setSessionCookie(
        response,
        result.sessionToken,
        result.response.session.expiresAt,
      );

      response.redirect(result.redirectUrl);
    } catch (error) {
      this.sessionCookieService.clearSessionCookie(response);
      response.redirect(
        this.authService.buildExternalAuthErrorRedirect('steam', error),
      );
    }
  }

  private extractRequestMetadata(request: Request): {
    ipAddress: string | null;
    userAgent: string | null;
  } {
    return {
      ipAddress: request.ip ?? null,
      userAgent:
        typeof request.headers['user-agent'] === 'string'
          ? request.headers['user-agent']
          : null,
    };
  }
}
