import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Response } from 'express';
import { firstValueFrom, of, throwError } from 'rxjs';
import type { JsonLoggerService } from '../logging/json-logger.service';
import { HttpLoggingInterceptor } from './http-logging.interceptor';
import type { RequestWithId } from './request-id.middleware';

describe('HttpLoggingInterceptor', () => {
  function createContext(type: string = 'http', originalUrl: string = '/health'): ExecutionContext {
    const request = {
      requestId: 'request-123',
      method: 'GET',
      originalUrl,
      path: new URL(originalUrl, 'http://localhost').pathname,
    } as RequestWithId;
    const response = { statusCode: 200 } as Response;

    return {
      getType: (): string => type,
      switchToHttp: () => ({
        getRequest: (): RequestWithId => request,
        getResponse: (): Response => response,
      }),
    } as unknown as ExecutionContext;
  }

  it('passes through non-HTTP execution contexts', async () => {
    const write = jest.fn();
    const interceptor = new HttpLoggingInterceptor({ write } as unknown as JsonLoggerService);
    const handler = { handle: () => of('worker-result') } as CallHandler;

    await expect(
      firstValueFrom(interceptor.intercept(createContext('rpc'), handler)),
    ).resolves.toBe('worker-result');
    expect(write).not.toHaveBeenCalled();
  });

  it('logs a completed HTTP request without its query string', async () => {
    const write = jest.fn();
    const interceptor = new HttpLoggingInterceptor({ write } as unknown as JsonLoggerService);
    const handler = { handle: () => of({ ok: true }) } as CallHandler;

    await firstValueFrom(interceptor.intercept(createContext('http', '/health?token=secret-value'), handler));

    expect(write).toHaveBeenCalledWith(
      'log',
      'http_request_completed',
      'Http',
      expect.objectContaining({
        requestId: 'request-123',
        method: 'GET',
        path: '/health',
        statusCode: 200,
        durationMs: expect.any(Number),
      }),
    );
    expect(JSON.stringify(write.mock.calls[0][3])).not.toContain('secret-value');
  });

  it('logs and rethrows failed HTTP requests', async () => {
    const write = jest.fn();
    const interceptor = new HttpLoggingInterceptor({ write } as unknown as JsonLoggerService);
    const error = new Error('request failed');
    const handler = { handle: () => throwError(() => error) } as CallHandler;

    await expect(
      firstValueFrom(interceptor.intercept(createContext('http', '/health?token=secret-value'), handler)),
    ).rejects.toBe(
      error,
    );
    expect(write).toHaveBeenCalledWith(
      'warn',
      'http_request_failed',
      'Http',
      expect.objectContaining({ requestId: 'request-123', path: '/health' }),
    );
    expect(JSON.stringify(write.mock.calls[0][3])).not.toContain('secret-value');
  });
});
