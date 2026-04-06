import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Response } from 'express';

import { AppLoggerService } from '../../logging/app-logger.service';
import type { RequestWithId } from '../interfaces/request-with-id.interface';

interface ExceptionPayloadShape {
  error?: string;
  message?: string | string[];
}

interface ErrorResponseBody {
  error: string;
  message: string | string[];
  path: string;
  requestId: string | null;
  statusCode: number;
  timestamp: string;
}

function isExceptionPayloadShape(
  value: unknown,
): value is ExceptionPayloadShape {
  return typeof value === 'object' && value !== null;
}

@Injectable()
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(
    @Inject(AppLoggerService) private readonly logger: AppLoggerService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithId>();
    const response = context.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = this.buildPayload(exception, status, request);

    this.logException(exception, payload);
    response.status(status).json(payload);
  }

  private buildPayload(
    exception: unknown,
    status: number,
    request: RequestWithId,
  ): ErrorResponseBody {
    const responseBody =
      exception instanceof HttpException ? exception.getResponse() : undefined;

    return {
      error: this.resolveError(exception, status, responseBody),
      message: this.resolveMessage(exception, responseBody),
      path: request.originalUrl ?? request.url,
      requestId: request.requestId ?? null,
      statusCode: status,
      timestamp: new Date().toISOString(),
    };
  }

  private resolveError(
    exception: unknown,
    status: number,
    responseBody: unknown,
  ): string {
    if (isExceptionPayloadShape(responseBody) && responseBody.error) {
      return responseBody.error;
    }

    if (exception instanceof Error && exception.name.length > 0) {
      return exception.name;
    }

    if (status === Number(HttpStatus.INTERNAL_SERVER_ERROR)) {
      return 'InternalServerError';
    }

    return 'RequestFailed';
  }

  private resolveMessage(
    exception: unknown,
    responseBody: unknown,
  ): string | string[] {
    if (isExceptionPayloadShape(responseBody) && responseBody.message) {
      return responseBody.message;
    }

    if (exception instanceof Error && exception.message.length > 0) {
      return exception.message;
    }

    return 'Internal server error';
  }

  private logException(exception: unknown, payload: ErrorResponseBody): void {
    const message = `[${payload.requestId ?? 'unknown-request'}] ${payload.statusCode} ${
      payload.path
    }`;

    if (exception instanceof Error && exception.stack) {
      this.logger.error(message, exception.stack, 'GlobalExceptionFilter');
      return;
    }

    this.logger.error(message, 'GlobalExceptionFilter');
  }
}
