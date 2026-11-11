import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { bootstrapApi, type ApiBootstrapOptions } from './bootstrap';
import { configuration } from './config/environment';
import { runStartupMigrations } from './database/startup-migrations';
import { JsonLoggerService } from './logging/json-logger.service';

jest.mock('@nestjs/core', () => ({ NestFactory: { create: jest.fn() } }));
jest.mock('./database/startup-migrations', () => ({ runStartupMigrations: jest.fn() }));

describe('API listener bootstrap', () => {
  const original = process.env;
  const logger = { write: jest.fn() };
  const listen = jest.fn();
  const app = {
    get: jest.fn(),
    listen,
    useLogger: jest.fn(),
    use: jest.fn(),
    enableCors: jest.fn(),
    useGlobalPipes: jest.fn(),
    useGlobalFilters: jest.fn(),
    useGlobalInterceptors: jest.fn(),
    enableShutdownHooks: jest.fn(),
  };
  class RootModule {}

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = {};
    jest.mocked(NestFactory.create).mockResolvedValue(app as never);
    app.get.mockImplementation((token: unknown) => {
      if (token === ConfigService) return new ConfigService(configuration());
      if (token === JsonLoggerService) return logger;
      return {};
    });
  });
  afterEach(() => {
    process.env = original;
  });

  const apis: Array<[ApiBootstrapOptions['portConfigKey'], string, number]> = [
    ['app.ports.renter', 'RENTER_API_PORT', 3001],
    ['app.ports.owner', 'OWNER_API_PORT', 3002],
    ['app.ports.admin', 'ADMIN_API_PORT', 3003],
  ];
  describe.each(apis)('%s', (portConfigKey, variable, defaultPort) => {
    it.each(['platform', 'service', 'default'])(
      'binds the %s port on all interfaces',
      async (mode) => {
        if (mode !== 'default') process.env[variable] = '3100';
        if (mode === 'platform') process.env.PORT = '10000';
        const expected = mode === 'platform' ? 10000 : mode === 'service' ? 3100 : defaultPort;
        await bootstrapApi(RootModule, { appName: 'TestApi', portConfigKey });
        expect(listen).toHaveBeenCalledWith(expected, '0.0.0.0');
        expect(logger.write).toHaveBeenCalledWith('log', 'application_started', 'TestApi', {
          port: expected,
        });
        expect(jest.mocked(runStartupMigrations).mock.invocationCallOrder[0]).toBeLessThan(
          listen.mock.invocationCallOrder[0]!,
        );
      },
    );
  });

  it('does not listen if startup migrations fail', async () => {
    jest.mocked(runStartupMigrations).mockRejectedValue(new Error('migration failed'));
    await expect(
      bootstrapApi(RootModule, { appName: 'TestApi', portConfigKey: 'app.ports.renter' }),
    ).rejects.toThrow('migration failed');
    expect(listen).not.toHaveBeenCalled();
    expect(logger.write).not.toHaveBeenCalled();
  });

  it('does not report startup success if binding fails', async () => {
    listen.mockRejectedValue(new Error('EADDRINUSE'));
    await expect(
      bootstrapApi(RootModule, { appName: 'TestApi', portConfigKey: 'app.ports.renter' }),
    ).rejects.toThrow('EADDRINUSE');
    expect(logger.write).not.toHaveBeenCalled();
  });
});
