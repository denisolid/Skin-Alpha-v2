import { randomUUID } from 'node:crypto';

import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';

import type { RequestWithId } from '../interfaces/request-with-id.interface';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: RequestWithId, response: Response, next: NextFunction): void {
    const requestId = this.resolveRequestId(request);

    request.requestId = requestId;
    response.setHeader('x-request-id', requestId);

    next();
  }

  private resolveRequestId(request: RequestWithId): string {
    const headerValue = request.header('x-request-id');

    if (headerValue && headerValue.trim().length > 0) {
      return headerValue;
    }

    return randomUUID();
  }
}
