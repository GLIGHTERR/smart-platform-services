import type { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports process liveness without database access', () => {
    const health = {} as HealthCheckService;
    const database = { pingCheck: jest.fn() } as unknown as TypeOrmHealthIndicator;
    const controller = new HealthController(health, database);

    expect(controller.liveness()).toEqual({
      status: 'ok',
      timestamp: expect.any(String),
    });
    expect(database.pingCheck).not.toHaveBeenCalled();
  });

  it('checks PostgreSQL for readiness', async () => {
    const result = { status: 'ok', info: {}, error: {}, details: {} };
    const check = jest.fn(async (indicators: Array<() => Promise<unknown>>) => {
      await indicators[0]?.();
      return result;
    });
    const pingCheck = jest.fn().mockResolvedValue({ database: { status: 'up' } });
    const controller = new HealthController(
      { check } as unknown as HealthCheckService,
      { pingCheck } as unknown as TypeOrmHealthIndicator,
    );

    await expect(controller.readiness()).resolves.toEqual(result);
    expect(pingCheck).toHaveBeenCalledWith('database');
  });

  it('checks PostgreSQL for readiness through the ready alias', async () => {
    const result = { status: 'ok', info: {}, error: {}, details: {} };
    const check = jest.fn(async (indicators: Array<() => Promise<unknown>>) => {
      await indicators[0]?.();
      return result;
    });
    const pingCheck = jest.fn().mockResolvedValue({ database: { status: 'up' } });
    const controller = new HealthController(
      { check } as unknown as HealthCheckService,
      { pingCheck } as unknown as TypeOrmHealthIndicator,
    );

    await expect(controller.readinessAlias()).resolves.toEqual(result);
    expect(pingCheck).toHaveBeenCalledTimes(1);
    expect(pingCheck).toHaveBeenCalledWith('database');
  });
});
