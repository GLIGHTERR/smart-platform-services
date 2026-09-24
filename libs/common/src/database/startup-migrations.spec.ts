import { ConfigService } from '@nestjs/config';
import type { DataSource, Migration } from 'typeorm';
import type { JsonLoggerService } from '../logging/json-logger.service';
import { runStartupMigrations } from './startup-migrations';

describe('runStartupMigrations', () => {
  const write = jest.fn();
  const logger = { write } as unknown as JsonLoggerService;

  function config(enabled: boolean, buildRevision?: string): ConfigService {
    return new ConfigService({
      app: { buildRevision },
      database: { runMigrationsOnStartup: enabled },
    });
  }

  function dataSource(overrides: Partial<DataSource> = {}): DataSource {
    return {
      showMigrations: jest.fn().mockResolvedValue(false),
      runMigrations: jest.fn().mockResolvedValue([]),
      ...overrides,
    } as unknown as DataSource;
  }

  beforeEach(() => {
    write.mockReset();
  });

  it('does not inspect or run migrations when the flag is false', async () => {
    const source = dataSource();

    await runStartupMigrations(config(false), source, logger);

    expect(source.showMigrations).not.toHaveBeenCalled();
    expect(source.runMigrations).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(
      'log',
      'database_migrations_startup_disabled',
      'DatabaseMigrationStartup',
      undefined,
    );
  });

  it('logs no pending work and preserves the build revision', async () => {
    const source = dataSource();

    await runStartupMigrations(config(true, 'abc123'), source, logger);

    expect(source.showMigrations).toHaveBeenCalledTimes(1);
    expect(source.runMigrations).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(
      'log',
      'database_migrations_no_pending',
      'DatabaseMigrationStartup',
      { buildRevision: 'abc123' },
    );
  });

  it('runs pending migrations through the TypeORM ledger', async () => {
    const migrations = [{ name: 'PasswordRecovery1700000003000' }] as unknown as Migration[];
    const source = dataSource({
      showMigrations: jest.fn().mockResolvedValue(true),
      runMigrations: jest.fn().mockResolvedValue(migrations),
    });

    await runStartupMigrations(config(true), source, logger);

    expect(source.runMigrations).toHaveBeenCalledWith({ transaction: 'all' });
    expect(write).toHaveBeenNthCalledWith(
      1,
      'log',
      'database_migrations_pending',
      'DatabaseMigrationStartup',
      undefined,
    );
    expect(write).toHaveBeenNthCalledWith(
      2,
      'log',
      'database_migrations_applied',
      'DatabaseMigrationStartup',
      { count: 1, migrations: ['PasswordRecovery1700000003000'] },
    );
  });

  it('fails bootstrap with a sanitized error when migration execution fails', async () => {
    const source = dataSource({
      showMigrations: jest.fn().mockResolvedValue(true),
      runMigrations: jest.fn().mockRejectedValue(new Error('password=do-not-log')),
    });

    await expect(runStartupMigrations(config(true), source, logger)).rejects.toThrow(
      'Database migrations failed during startup',
    );
    expect(write).toHaveBeenLastCalledWith(
      'error',
      'database_migrations_failed',
      'DatabaseMigrationStartup',
      undefined,
    );
    expect(JSON.stringify(write.mock.calls)).not.toContain('do-not-log');
  });
});
