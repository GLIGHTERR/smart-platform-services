import { ConfigService } from '@nestjs/config';
import { createDatabaseOptions } from './database-options';

describe('createDatabaseOptions', () => {
  function config(values: Record<string, unknown>): ConfigService {
    return new ConfigService({
      database: {
        host: 'db.example.com',
        port: 5432,
        name: 'platform',
        user: 'platform',
        password: 'secret-password',
        ssl: false,
        sslRejectUnauthorized: true,
        poolSize: 10,
        ...values,
      },
    });
  }

  it('bundles all migrations with the platform ledger and transaction mode', () => {
    const options = createDatabaseOptions(config({}));

    expect(options).toEqual(
      expect.objectContaining({
        migrationsRun: false,
        migrationsTableName: 'platform_migrations',
        migrationsTransactionMode: 'all',
      }),
    );
    expect(
      (options.migrations as Array<{ name: string }>).map((migration) => migration.name),
    ).toEqual([
      'InitialPlatformSchema1700000000000',
      'IdentityAuthSchema1700000001000',
      'EmailIdentityAuth1700000002000',
      'PasswordRecovery1700000003000',
    ]);
  });

  it('maps SSL and pool configuration without exposing credentials', () => {
    const options = createDatabaseOptions(
      config({ ssl: true, sslRejectUnauthorized: false, poolSize: 7 }),
    ) as unknown as {
      ssl: { rejectUnauthorized: boolean };
      extra: { max: number; application_name: string };
    };

    expect(options.ssl).toEqual({ rejectUnauthorized: false });
    expect(options.extra).toEqual({
      max: 7,
      application_name: 'smart-platform-services',
    });
  });
});
