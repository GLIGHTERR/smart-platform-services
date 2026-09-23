import dataSource from './data-source';

interface TableRow {
  table_name: string;
}

interface RoleRow {
  code: string;
}

interface CountRow {
  count: string;
}

interface ColumnRow {
  column_name: string;
}

const REQUIRED_TABLES = [
  'roles',
  'users',
  'user_roles',
  'owner_profiles',
  'renter_profiles',
  'social_identities',
  'otp_challenges',
  'auth_sessions',
  'auth_throttle_buckets',
  'properties',
  'rooms',
  'bookings',
  'contracts',
  'invoices',
  'invoice_items',
  'payments',
  'payment_events',
  'payment_allocations',
  'maintenance_reports',
  'notifications',
  'media_files',
  'audit_logs',
  'password_reset_tokens',
  'outbox_events',
] as const;

async function verifySchema(): Promise<void> {
  await dataSource.initialize();

  try {
    const tables = await dataSource.query<TableRow[]>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const existingTables = new Set(tables.map((row) => row.table_name));
    const missingTables = REQUIRED_TABLES.filter((table) => !existingTables.has(table));
    if (missingTables.length > 0) {
      throw new Error(`Schema verification failed; missing tables: ${missingTables.join(', ')}`);
    }

    const roles = await dataSource.query<RoleRow[]>(`SELECT code FROM roles ORDER BY code`);
    const existingRoles = new Set(roles.map((row) => row.code));
    const missingRoles = ['renter', 'owner', 'admin'].filter((role) => !existingRoles.has(role));
    if (missingRoles.length > 0) {
      throw new Error(`Schema verification failed; missing roles: ${missingRoles.join(', ')}`);
    }

    const [auditTrigger] = await dataSource.query<CountRow[]>(`
      SELECT count(*)::text AS count
      FROM pg_trigger
      WHERE tgname = 'trg_audit_logs_append_only' AND NOT tgisinternal
    `);
    if (auditTrigger?.count !== '1') {
      throw new Error('Schema verification failed; append-only audit trigger is missing');
    }

    const emailAuthColumns = await dataSource.query<ColumnRow[]>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          (table_name = 'users' AND column_name = 'phone_login_enabled')
          OR (table_name = 'otp_challenges' AND column_name IN ('email', 'verified_at'))
        )
    `);
    if (emailAuthColumns.length !== 3) {
      throw new Error('Schema verification failed; email identity columns are missing');
    }

    process.stdout.write(
      `Schema verified: ${REQUIRED_TABLES.length} required tables, email identity columns, 3 base roles and append-only audit.\n`,
    );
  } finally {
    await dataSource.destroy();
  }
}

void verifySchema().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
