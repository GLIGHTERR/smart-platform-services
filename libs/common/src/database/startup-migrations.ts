import type { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import type { JsonLoggerService } from '../logging/json-logger.service';

const CONTEXT = 'DatabaseMigrationStartup';

export async function runStartupMigrations(
  config: ConfigService,
  dataSource: DataSource,
  logger: JsonLoggerService,
): Promise<void> {
  const buildRevision = config.get<string>('app.buildRevision') || undefined;
  const metadata = buildRevision ? { buildRevision } : undefined;

  if (!config.get<boolean>('database.runMigrationsOnStartup', false)) {
    logger.write('log', 'database_migrations_startup_disabled', CONTEXT, metadata);
    return;
  }

  try {
    if (!(await dataSource.showMigrations())) {
      logger.write('log', 'database_migrations_no_pending', CONTEXT, metadata);
      return;
    }

    logger.write('log', 'database_migrations_pending', CONTEXT, metadata);
    const applied = await dataSource.runMigrations({ transaction: 'all' });
    logger.write('log', 'database_migrations_applied', CONTEXT, {
      ...metadata,
      count: applied.length,
      migrations: applied.map((migration) => migration.name),
    });
  } catch {
    logger.write('error', 'database_migrations_failed', CONTEXT, metadata);
    throw new Error('Database migrations failed during startup');
  }
}
