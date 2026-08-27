import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { JsonLoggerService } from '../logging/json-logger.service';
import type { RequestWithId } from './request-id.middleware';

interface ExceptionResponse {
  code?: string;
  message?: string | string[];
  details?: unknown;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  public constructor(private readonly logger: JsonLoggerService) {}

  public catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const exceptionResponse = this.getExceptionResponse(exception);
    const isUnexpected = status >= 500;

    if (isUnexpected) {
      const error = exception instanceof Error ? exception : new Error('Unknown exception');
      this.logger.error(error.message, error.stack, 'ApiExceptionFilter');
    }

    response.status(status).json({
      error: {
        code: exceptionResponse.code ?? this.statusCodeName(status),
        message: isUnexpected
          ? 'An unexpected error occurred'
          : this.getPublicMessage(exceptionResponse.message),
        ...(exceptionResponse.details === undefined ? {} : { details: exceptionResponse.details }),
        requestId: request.requestId,
        timestamp: new Date().toISOString(),
        path: request.originalUrl,
      },
    });
  }

  private getExceptionResponse(exception: unknown): ExceptionResponse {
    if (!(exception instanceof HttpException)) {
      return {};
    }

    const value = exception.getResponse();
    if (typeof value === 'string') {
      return { message: value };
    }

    const body = value as ExceptionResponse;
    if (Array.isArray(body.message)) {
      return {
        ...body,
        message: 'Request validation failed',
        details: body.message,
      };
    }
    return body;
  }

  private getPublicMessage(message: string | string[] | undefined): string {
    if (Array.isArray(message)) {
      return message.join(', ');
    }
    return message ?? 'Request failed';
  }

  private statusCodeName(status: number): string {
    return typeof HttpStatus[status] === 'string' ? String(HttpStatus[status]) : 'HTTP_ERROR';
  }
}
