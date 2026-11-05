import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { platformMigrations } from '../database/migrations';
import { PasswordChange1700000007000 } from '../database/migrations/1700000007000-password-change';
import { PostgresIdentityRepository } from '../libs/identity/src/persistence/postgres-identity.repository';

// Explicit opt-in, fixed loopback endpoint and disposable database; never use DATABASE_URL.
const postgres = process.env.GLI261_POSTGRES_TEST === '1' ? describe : describe.skip;
postgres('UC-06 production PostgreSQL transactions', () => {
  const db = new DataSource({
    type: 'postgres',
    host: '127.0.0.1',
    port: 55461,
    username: 'postgres',
    database: 'gli261_test',
    migrations: platformMigrations,
    extra: { max: 10, statement_timeout: 5000 },
  });
  let repo: PostgresIdentityRepository;
  let userId: string;
  let currentId: string;
  let otherId: string;
  let familyId: string;
  const now = new Date('2026-11-05T00:00:00Z');
  const expiresAt = new Date('2026-11-06T00:00:00Z');
  const oldHash = 'synthetic-verified-hash';
  beforeAll(async () => {
    await db.initialize();
    const [version] =
      await db.query<Array<{ server_version_num: string }>>('SHOW server_version_num');
    expect(Number(version?.server_version_num)).toBeGreaterThanOrEqual(170000);
    expect(Number(version?.server_version_num)).toBeLessThan(180000);
    await db.runMigrations();
    repo = new PostgresIdentityRepository(db);
  });
  afterAll(async () => {
    await db.destroy();
  });
  beforeEach(async () => {
    userId = randomUUID();
    currentId = randomUUID();
    otherId = randomUUID();
    familyId = randomUUID();
    await db.query(
      `INSERT INTO users(id,email,display_name,status,password_hash)
      VALUES ($1,$2,'UC06 test','active',$3)`,
      [userId, `${userId}@example.invalid`, oldHash],
    );
    for (const id of [currentId, otherId]) {
      await repo.createSession({
        id,
        familyId: id === otherId ? familyId : randomUUID(),
        userId,
        refreshTokenHash: id,
        expiresAt,
        ipAddress: null,
        userAgent: null,
      });
    }
  });
  function change(
    key = 'a',
    hash = 'synthetic-new-hash',
  ): Parameters<PostgresIdentityRepository['changePasswordForCurrentSession']>[0] {
    return {
      userId,
      currentSessionId: currentId,
      expectedPasswordHash: oldHash,
      passwordHash: hash,
      idempotencyKeyHash: key.repeat(64),
      changedAt: now,
      audit: {
        eventType: 'password_change.completed',
        userId,
        maskedEmail: 'test@example.invalid',
        occurredAt: now,
        ipAddress: null,
        userAgent: null,
      },
    };
  }
  function rotation(): Parameters<PostgresIdentityRepository['rotateSession']>[0] {
    return {
      currentSessionId: otherId,
      currentFamilyId: familyId,
      currentTokenHash: otherId,
      replacement: {
        id: randomUUID(),
        familyId,
        userId,
        refreshTokenHash: randomUUID(),
        expiresAt,
        ipAddress: null,
        userAgent: null,
      },
      usedAt: now,
    };
  }
  async function unchanged(): Promise<void> {
    expect(await db.query('SELECT password_hash FROM users WHERE id=$1', [userId])).toEqual([
      { password_hash: oldHash },
    ]);
    expect(await repo.findPasswordChangeOutcome(userId, 'a'.repeat(64))).toBe(false);
    expect(await db.query('SELECT id FROM audit_logs WHERE subject_id=$1', [userId])).toHaveLength(
      0,
    );
    expect(await repo.isSessionActive(otherId, userId, now)).toBe(true);
  }
  it('commits one authoritative outcome, preserves current session and replays without rewriting', async () => {
    expect(await repo.findPasswordChangeOutcome(userId, 'a'.repeat(64))).toBe(false);
    await expect(repo.changePasswordForCurrentSession(change())).resolves.toBe('changed');
    await expect(repo.changePasswordForCurrentSession(change('a', 'ignored'))).resolves.toBe(
      'replayed',
    );
    expect(await repo.findPasswordChangeOutcome(userId, 'a'.repeat(64))).toBe(true);
    expect(await repo.isSessionActive(currentId, userId, now)).toBe(true);
    expect(await repo.isSessionActive(otherId, userId, now)).toBe(false);
    expect(await db.query('SELECT id FROM audit_logs WHERE subject_id=$1', [userId])).toHaveLength(
      1,
    );
  });
  it('allows only one of two distinct keys that verified the same credential', async () => {
    const barrier = db.createQueryRunner();
    await barrier.connect();
    await barrier.startTransaction();
    await barrier.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
    const pending = Promise.allSettled([
      repo.changePasswordForCurrentSession(change('a', 'first')),
      repo.changePasswordForCurrentSession(change('b', 'second')),
    ]);
    try {
      let waiters = 0;
      for (let attempt = 0; attempt < 100; attempt++) {
        const [row] = await db.query<
          Array<{ count: string }>
        >(`SELECT count(*) FROM pg_stat_activity
          WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid))>0`);
        waiters = Number(row?.count);
        if (waiters === 2) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiters).toBe(2);
    } finally {
      await barrier.rollbackTransaction();
      await barrier.release();
    }
    const results = await pending;
    const failure = results.find((result) => result.status === 'rejected');
    expect(failure).toMatchObject({ reason: { response: { code: 'PASSWORD_CHANGE_CONFLICT' } } });
    const winner = results.findIndex((result) => result.status === 'fulfilled');
    expect(await db.query('SELECT password_hash FROM users WHERE id=$1', [userId])).toEqual([
      { password_hash: winner === 0 ? 'first' : 'second' },
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(
      await db.query('SELECT user_id FROM password_change_idempotency WHERE user_id=$1', [userId]),
    ).toHaveLength(1);
    expect(await db.query('SELECT id FROM audit_logs WHERE subject_id=$1', [userId])).toHaveLength(
      1,
    );
  });
  it('replays concurrent identical keys', async () => {
    expect(
      (
        await Promise.all([
          repo.changePasswordForCurrentSession(change()),
          repo.changePasswordForCurrentSession(change()),
        ])
      ).sort(),
    ).toEqual(['changed', 'replayed']);
  });
  it('revokes a replacement created by an overlapping refresh', async () => {
    // Pause refresh after it locks its old session. On the vulnerable implementation,
    // revocation takes its UPDATE snapshot before the replacement has been inserted.
    const runner = db.createQueryRunner();
    await runner.connect();
    const original = runner.manager.query.bind(runner.manager);
    let release!: () => void;
    let reached!: () => void;
    const paused = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = jest.spyOn(runner.manager, 'query').mockImplementation(async (sql, params) => {
      const result: unknown = await original(sql, params);
      if (String(sql).includes('SELECT id, family_id, user_id')) {
        reached();
        await resume;
      }
      return result;
    });
    const refreshRepo = new PostgresIdentityRepository({
      transaction: async (work: (m: EntityManager) => Promise<unknown>) => {
        await runner.startTransaction();
        try {
          const value = await work(runner.manager);
          await runner.commitTransaction();
          return value;
        } catch (error) {
          await runner.rollbackTransaction();
          throw error;
        }
      },
    } as DataSource);
    const input = rotation();
    const refreshing = refreshRepo.rotateSession(input);
    await paused;
    const changing = repo.changePasswordForCurrentSession(change());
    try {
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const rows = await db.query<Array<{ blocked: boolean }>>(`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid))>0
        ) AS blocked`);
        if (rows[0]?.blocked) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
    } finally {
      release();
    }
    try {
      await expect(refreshing).resolves.toBe('rotated');
      await expect(changing).resolves.toBe('changed');
      expect(await repo.isSessionActive(input.replacement.id, userId, now)).toBe(false);
      expect(await repo.isSessionActive(currentId, userId, now)).toBe(true);
    } finally {
      spy.mockRestore();
      await runner.release();
    }
  });
  it('rejects refresh after a completed password change', async () => {
    await repo.changePasswordForCurrentSession(change());
    const input = rotation();
    await expect(repo.rotateSession(input)).resolves.toBe('reused');
    expect(await repo.isSessionActive(input.replacement.id, userId, now)).toBe(false);
  });
  it.each([
    'missing-user',
    'missing-session',
    'wrong-token',
    'wrong-family',
    'replacement-user',
    'replacement-family',
    'expired',
  ])('preserves refresh rejection semantics for %s', async (kind) => {
    const input = rotation();
    if (kind === 'missing-user') input.replacement.userId = randomUUID();
    if (kind === 'missing-session') input.currentSessionId = randomUUID();
    if (kind === 'wrong-token') input.currentTokenHash = 'unmatched';
    if (kind === 'wrong-family') input.currentFamilyId = randomUUID();
    if (kind === 'replacement-family') input.replacement.familyId = randomUUID();
    if (kind === 'replacement-user') {
      const stranger = randomUUID();
      await db.query(
        "INSERT INTO users(id,email,display_name,status) VALUES ($1,$2,'stranger','active')",
        [stranger, `${stranger}@example.invalid`],
      );
      input.replacement.userId = stranger;
    }
    if (kind === 'expired')
      await db.query('UPDATE auth_sessions SET expires_at=$2 WHERE id=$1', [otherId, now]);
    await expect(repo.rotateSession(input)).resolves.toBe(
      kind === 'expired' ? 'expired' : 'missing',
    );
    expect(await repo.isSessionActive(input.replacement.id, userId, now)).toBe(false);
    expect(await repo.isSessionActive(currentId, userId, now)).toBe(true);
  });
  it.each(['inactive', 'deleted', 'passwordless', 'stale', 'missing'])(
    'rejects %s user/credential without mutation',
    async (kind) => {
      const input = change();
      if (kind === 'inactive')
        await db.query("UPDATE users SET status='disabled' WHERE id=$1", [userId]);
      if (kind === 'deleted')
        await db.query('UPDATE users SET deleted_at=$2 WHERE id=$1', [userId, now]);
      if (kind === 'passwordless')
        await db.query('UPDATE users SET password_hash=NULL WHERE id=$1', [userId]);
      if (kind === 'stale') input.expectedPasswordHash = 'stale';
      if (kind === 'missing') input.userId = randomUUID();
      await expect(repo.changePasswordForCurrentSession(input)).rejects.toBeDefined();
      expect(await repo.findPasswordChangeOutcome(userId, input.idempotencyKeyHash)).toBe(false);
      expect(await repo.isSessionActive(otherId, userId, now)).toBe(true);
    },
  );
  it.each(['expired', 'revoked', 'wrong-subject', 'missing'])(
    'rejects %s current session and rolls back',
    async (kind) => {
      const input = change();
      if (kind === 'expired')
        await db.query('UPDATE auth_sessions SET expires_at=$2 WHERE id=$1', [currentId, now]);
      if (kind === 'revoked')
        await db.query('UPDATE auth_sessions SET revoked_at=$2 WHERE id=$1', [currentId, now]);
      if (kind === 'wrong-subject') {
        const stranger = randomUUID();
        await db.query(
          "INSERT INTO users(id,email,display_name,status) VALUES ($1,$2,'stranger','active')",
          [stranger, `${stranger}@example.invalid`],
        );
        await db.query('UPDATE auth_sessions SET user_id=$2 WHERE id=$1', [currentId, stranger]);
      }
      if (kind === 'missing') input.currentSessionId = randomUUID();
      await expect(repo.changePasswordForCurrentSession(input)).rejects.toBeDefined();
      await unchanged();
    },
  );
  it('rolls back password, revocation and outcome on audit SQL failure', async () => {
    const input = change();
    input.audit.ipAddress = 'invalid-inet' as never;
    await expect(repo.changePasswordForCurrentSession(input)).rejects.toBeDefined();
    await unchanged();
  });
  it('rolls back SQL failure in revocation', async () => {
    await db.query(`CREATE FUNCTION uc06_fail_revoke() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic failure'; END $$;
      CREATE TRIGGER uc06_fail_revoke BEFORE UPDATE ON auth_sessions FOR EACH ROW EXECUTE FUNCTION uc06_fail_revoke()`);
    try {
      await expect(repo.changePasswordForCurrentSession(change())).rejects.toBeDefined();
      await unchanged();
    } finally {
      await db.query(
        'DROP TRIGGER uc06_fail_revoke ON auth_sessions; DROP FUNCTION uc06_fail_revoke()',
      );
    }
  });
  it('round-trips the actual UC-06 migration without altering passwords or sessions', async () => {
    const runner = db.createQueryRunner();
    const migration = new PasswordChange1700000007000();
    await migration.down(runner);
    await migration.up(runner);
    await unchanged();
    await runner.release();
  });
});
