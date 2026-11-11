import {
  ConflictException,
  UnauthorizedException,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from '../services/auth.service';
import { JwtSessionService } from '../security/jwt-session.service';
import { ApiExceptionFilter } from '../../../common/src/http/api-exception.filter';
import type { JsonLoggerService } from '../../../common/src/logging/json-logger.service';
import { HttpLoggingInterceptor } from '../../../common/src/http/http-logging.interceptor';

describe('UC-06 HTTP contract', () => {
  let app: INestApplication;
  let url: string;
  const actor = {
    id: 'fixture-subject',
    sessionId: 'fixture-session',
    status: 'active',
    roles: ['renter'],
  };
  const changePassword = jest.fn();
  const logger = { write: jest.fn(), error: jest.fn() };
  const body = {
    currentPassword: 'Current1!',
    newPassword: 'Changed1!',
    confirmPassword: 'Changed1!',
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: { changePassword } },
        {
          provide: JwtSessionService,
          useValue: {
            authenticateAccess: async (token: string): Promise<typeof actor> => {
              if (token !== 'synthetic-access')
                throw new UnauthorizedException({ code: 'INVALID_SESSION' });
              return actor;
            },
          },
        },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new ApiExceptionFilter(logger as unknown as JsonLoggerService));
    app.useGlobalInterceptors(new HttpLoggingInterceptor(logger as unknown as JsonLoggerService));
    await app.listen(0, '127.0.0.1');
    url = `${await app.getUrl()}/auth/password/change`;
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    changePassword.mockReset().mockResolvedValue({ changed: true, next: 'profile' });
  });
  async function post(
    input: unknown,
    authorization = 'Bearer synthetic-access',
  ): Promise<Response> {
    return fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization,
        'idempotency-key': 'fixture-key',
      },
      body: JSON.stringify(input),
    });
  }
  it('binds the authenticated subject, forwards canonical input and returns only a no-store acknowledgement', async () => {
    const response = await post(body);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ changed: true, next: 'profile' });
    expect(changePassword).toHaveBeenCalledWith(
      actor,
      body,
      expect.objectContaining({ deviceId: null }),
      'fixture-key',
    );
    const logs = JSON.stringify(logger.write.mock.calls);
    for (const value of Object.values(body)) expect(logs).not.toContain(value);
    expect(logs).not.toContain('synthetic-access');
  });
  it.each(['missing-confirmation', 'extra-subject', 'invalid-policy'])(
    'rejects %s at the HTTP boundary before calling business logic',
    async (kind) => {
      const input: Record<string, unknown> = { ...body };
      if (kind === 'missing-confirmation') delete input.confirmPassword;
      if (kind === 'extra-subject') input.userId = 'another-user';
      if (kind === 'invalid-policy') input.newPassword = 'weak';
      const response = await post(input);
      expect(response.status).toBe(400);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(changePassword).not.toHaveBeenCalled();
      const output = await response.text();
      for (const value of Object.values(body)) expect(output).not.toContain(value);
    },
  );
  it.each(['', 'Bearer expired-fixture'])(
    'rejects unauthenticated/invalid sessions',
    async (authorization) => {
      const response = await post(body, authorization);
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(changePassword).not.toHaveBeenCalled();
    },
  );
  it('returns safe authoritative conflict without leaking input', async () => {
    changePassword.mockRejectedValueOnce(
      new ConflictException({
        code: 'PASSWORD_CHANGE_CONFLICT',
        message: 'Password change conflicted; retry with current credentials',
      }),
    );
    const response = await post(body);
    expect(response.status).toBe(409);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ error: { code: 'PASSWORD_CHANGE_CONFLICT' } });
  });
});
