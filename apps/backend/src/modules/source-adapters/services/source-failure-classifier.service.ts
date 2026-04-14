import { IngestionFailureClass } from '@prisma/client';
import { Injectable } from '@nestjs/common';

@Injectable()
export class SourceFailureClassifierService {
  classify(error: unknown): IngestionFailureClass {
    if (error instanceof Error) {
      return this.classifyMessage(error.message);
    }

    if (typeof error === 'string') {
      return this.classifyMessage(error);
    }

    return IngestionFailureClass.UNKNOWN;
  }

  classifyMessage(message: string): IngestionFailureClass {
    const normalizedMessage = message.trim().toLowerCase();

    if (normalizedMessage.length === 0) {
      return IngestionFailureClass.UNKNOWN;
    }

    if (
      normalizedMessage.includes('timed out') ||
      normalizedMessage.includes('timeout') ||
      normalizedMessage.includes('etimedout')
    ) {
      return IngestionFailureClass.TIMEOUT;
    }

    if (
      normalizedMessage.includes('rate limit') ||
      normalizedMessage.includes('too many requests') ||
      normalizedMessage.includes('429') ||
      normalizedMessage.includes('cooldown')
    ) {
      return IngestionFailureClass.RATE_LIMITED;
    }

    if (
      normalizedMessage.includes('connection pool') ||
      normalizedMessage.includes('deadlock') ||
      normalizedMessage.includes('database') ||
      normalizedMessage.includes('prisma')
    ) {
      return IngestionFailureClass.DB_CONTENTION;
    }

    if (
      normalizedMessage.includes('unauthorized') ||
      normalizedMessage.includes('forbidden') ||
      normalizedMessage.includes('401') ||
      normalizedMessage.includes('403') ||
      normalizedMessage.includes('token')
    ) {
      return IngestionFailureClass.AUTH;
    }

    if (
      normalizedMessage.includes('schema') ||
      normalizedMessage.includes('unexpected payload') ||
      normalizedMessage.includes('validation') ||
      normalizedMessage.includes('shape')
    ) {
      return IngestionFailureClass.SCHEMA_CHANGED;
    }

    if (
      normalizedMessage.includes('cursor') &&
      (normalizedMessage.includes('invalid') ||
        normalizedMessage.includes('expired') ||
        normalizedMessage.includes('unsupported'))
    ) {
      return IngestionFailureClass.CURSOR_INVALID;
    }

    if (
      normalizedMessage.includes('empty payload') ||
      normalizedMessage.includes('no listings') ||
      normalizedMessage.includes('no candidates')
    ) {
      return IngestionFailureClass.EMPTY_VALID;
    }

    if (
      normalizedMessage.includes('network') ||
      normalizedMessage.includes('econnreset') ||
      normalizedMessage.includes('socket hang up') ||
      normalizedMessage.includes('enotfound') ||
      normalizedMessage.includes('503') ||
      normalizedMessage.includes('502')
    ) {
      return IngestionFailureClass.NETWORK;
    }

    if (
      normalizedMessage.includes('poison') ||
      normalizedMessage.includes('cannot parse') ||
      normalizedMessage.includes('failed to parse')
    ) {
      return IngestionFailureClass.POISON_PAYLOAD;
    }

    return IngestionFailureClass.UNKNOWN;
  }
}
