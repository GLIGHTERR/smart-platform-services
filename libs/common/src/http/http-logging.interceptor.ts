import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { catchError, Observable, tap, throwError } from 'rxjs';
import { JsonLoggerService } from '../logging/json-logger.service';
import type { RequestWithId } from './request-id.middleware';

@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  public constructor(private readonly logger: JsonLoggerService) {}

  public intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<RequestWithId>();
    const response = context.switchToHttp().getResponse<Response>();
    const startedAt = performance.now();
    const metadata = (statusCode = response.statusCode): Record<string, unknown> => ({
      requestId: request.requestId,
      method: request.method,
      path: request.path,
      statusCode,
      durationMs: Number((performance.now() - startedAt).toFixed(2)),
    });

    return next.handle().pipe(
      tap(() => this.logger.write('log', 'http_request_completed', 'Http', metadata())),
      catchError((error: unknown) => {
        const statusCode = error instanceof HttpException ? error.getStatus() : 500;
        this.logger.write('warn', 'http_request_failed', 'Http', metadata(statusCode));
        return throwError(() => error);
      }),
    );
  }
}
