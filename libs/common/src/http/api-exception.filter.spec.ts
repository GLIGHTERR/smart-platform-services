import {
  BadRequestException,
  InternalServerErrorException,
  type ArgumentsHost,
} from '@nestjs/common';
import type { Response } from 'express';
import type { JsonLoggerService } from '../logging/json-logger.service';
import { ApiExceptionFilter } from './api-exception.filter';
import type { RequestWithId } from './request-id.middleware';

describe('ApiExceptionFilter', () => {
  function createHarness(): {
    filter: ApiExceptionFilter;
    status: jest.Mock;
    json: jest.Mock;
    loggerError: jest.Mock;
    host: ArgumentsHost;
  } {
    const status = jest.fn();
    const json = jest.fn();
    const response = { status, json } as unknown as Response;
    status.mockReturnValue(response);
    const request = {
      requestId: 'request-123',
      originalUrl: '/bookings',
    } as RequestWithId;
    const loggerError = jest.fn();
    const logger = { error: loggerError } as unknown as JsonLoggerService;
    const host = {
      switchToHttp: (): {
        getRequest: () => RequestWithId;
        getResponse: () => Response;
      } => ({
        getRequest: (): RequestWithId => request,
        getResponse: (): Response => response,
      }),
    } as unknown as ArgumentsHost;

    return { filter: new ApiExceptionFilter(logger), status, json, loggerError, host };
  }

  it('maps validation errors to the shared envelope', () => {
    const harness = createHarness();

    harness.filter.catch(
      new BadRequestException({ message: ['email must be an email'] }),
      harness.host,
    );

    expect(harness.status).toHaveBeenCalledWith(400);
    expect(harness.json).toHaveBeenCalledWith({
      error: expect.objectContaining({
        code: 'BAD_REQUEST',
        message: 'Request validation failed',
        details: ['email must be an email'],
        requestId: 'request-123',
        path: '/bookings',
      }),
    });
    expect(harness.loggerError).not.toHaveBeenCalled();
  });

  it('does not leak unexpected exception details', () => {
    const harness = createHarness();

    harness.filter.catch(new Error('database password leaked'), harness.host);

    expect(harness.status).toHaveBeenCalledWith(500);
    expect(harness.json).toHaveBeenCalledWith({
      error: expect.objectContaining({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
      }),
    });
    expect(harness.loggerError).toHaveBeenCalledWith(
      'database password leaked',
      expect.any(String),
      'ApiExceptionFilter',
    );
  });

  it('does not expose HttpException details for server errors', () => {
    const harness = createHarness();

    harness.filter.catch(
      new InternalServerErrorException({
        code: 'DATABASE_FAILURE',
        message: 'database connection failed: secret-host',
        details: { host: 'secret-host', password: 'not-for-clients' },
      }),
      harness.host,
    );

    expect(harness.status).toHaveBeenCalledWith(500);
    expect(harness.json).toHaveBeenCalledWith({
      error: expect.objectContaining({
        code: 'DATABASE_FAILURE',
        message: 'An unexpected error occurred',
        requestId: 'request-123',
        path: '/bookings',
      }),
    });
    const payload = harness.json.mock.calls[0][0] as { error: Record<string, unknown> };
    expect(payload.error).not.toHaveProperty('details');
    expect(JSON.stringify(payload)).not.toContain('secret-host');
    expect(harness.loggerError).toHaveBeenCalledWith(
      'database connection failed: secret-host',
      expect.any(String),
      'ApiExceptionFilter',
    );
  });
});
