import type { DataSource, EntityManager } from 'typeorm';
import { PostgresIdentityRepository } from './postgres-identity.repository';

describe('PostgresIdentityRepository OTP mutations', () => {
  const challengeId = '891124c5-c5e4-4c1e-b268-b28644046570';
  const timestamp = new Date('2026-09-21T10:00:00.000Z');

  function repositoryWithResult(result: unknown): {
    repository: PostgresIdentityRepository;
    query: jest.Mock;
  } {
    const query = jest.fn().mockResolvedValue(result);
    const dataSource = { query } as unknown as DataSource;
    return { repository: new PostgresIdentityRepository(dataSource), query };
  }

  it.each([
    ['verification', 'markOtpVerified'],
    ['consumption', 'consumeOtp'],
  ] as const)('accepts the PostgreSQL UPDATE result shape for OTP %s', async (_name, method) => {
    const { repository } = repositoryWithResult([[{ id: challengeId }], 1]);

    await expect(repository[method](challengeId, timestamp)).resolves.toBe(true);
  });

  it.each([
    ['verification', 'markOtpVerified'],
    ['consumption', 'consumeOtp'],
  ] as const)('rejects an OTP %s update that affected no rows', async (_name, method) => {
    const { repository } = repositoryWithResult([[], 0]);

    await expect(repository[method](challengeId, timestamp)).resolves.toBe(false);
  });

  it('keeps compatibility with a plain returned-row array', async () => {
    const { repository } = repositoryWithResult([{ id: challengeId }]);

    await expect(repository.markOtpVerified(challengeId, timestamp)).resolves.toBe(true);
  });

  it('atomically consumes the OTP, stores the hashed token, and writes a masked audit', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ id: challengeId }])
      .mockResolvedValue(undefined);
    const manager = { query } as unknown as EntityManager;
    const dataSource = {
      transaction: jest.fn(async (work: (value: EntityManager) => Promise<boolean>) =>
        work(manager),
      ),
    } as unknown as DataSource;
    const repository = new PostgresIdentityRepository(dataSource);

    await expect(
      repository.issuePasswordResetToken({
        challengeId,
        userId: '234cc3de-18ca-4b8b-a45d-522b9ec5d31e',
        email: 'user@example.com',
        codeHash: 'a'.repeat(64),
        tokenHash: 'b'.repeat(64),
        contextHash: 'c'.repeat(64),
        expiresAt: new Date('2026-09-21T10:10:00.000Z'),
        issuedAt: timestamp,
        audit: {
          eventType: 'password_recovery.verified',
          userId: '234cc3de-18ca-4b8b-a45d-522b9ec5d31e',
          maskedEmail: 'us**@example.com',
          occurredAt: timestamp,
          ipAddress: '203.0.113.10',
          userAgent: 'jest',
        },
      }),
    ).resolves.toBe(true);
    expect(query).toHaveBeenCalledTimes(4);
    expect(String(query.mock.calls[2]?.[0])).toContain('INSERT INTO password_reset_tokens');
    expect(String(query.mock.calls[3]?.[0])).toContain('INSERT INTO audit_logs');
    expect(JSON.stringify(query.mock.calls)).not.toContain('123456');
  });

  it('does not issue a reset token when the locked challenge is no longer eligible', async () => {
    const query = jest.fn().mockResolvedValueOnce([]);
    const manager = { query } as unknown as EntityManager;
    const dataSource = {
      transaction: jest.fn(async (work: (value: EntityManager) => Promise<boolean>) =>
        work(manager),
      ),
    } as unknown as DataSource;
    const repository = new PostgresIdentityRepository(dataSource);

    await expect(
      repository.issuePasswordResetToken({
        challengeId,
        userId: '234cc3de-18ca-4b8b-a45d-522b9ec5d31e',
        email: 'user@example.com',
        codeHash: 'a'.repeat(64),
        tokenHash: 'b'.repeat(64),
        contextHash: 'c'.repeat(64),
        expiresAt: new Date('2026-09-21T10:10:00.000Z'),
        issuedAt: timestamp,
        audit: {
          eventType: 'password_recovery.verified',
          userId: null,
          maskedEmail: 'us**@example.com',
          occurredAt: timestamp,
          ipAddress: null,
          userAgent: null,
        },
      }),
    ).resolves.toBe(false);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('resets password, consumes token, revokes sessions, and audits in one transaction', async () => {
    const userId = '234cc3de-18ca-4b8b-a45d-522b9ec5d31e';
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        {
          user_id: userId,
          token_hash: 'b'.repeat(64),
          context_hash: 'c'.repeat(64),
          expires_at: new Date('2026-09-21T10:10:00.000Z'),
          consumed_at: null,
        },
      ])
      .mockResolvedValueOnce([{ id: userId }])
      .mockResolvedValue(undefined);
    const manager = { query } as unknown as EntityManager;
    const dataSource = {
      transaction: jest.fn(async (work: (value: EntityManager) => Promise<string>) =>
        work(manager),
      ),
    } as unknown as DataSource;
    const repository = new PostgresIdentityRepository(dataSource);

    await expect(
      repository.resetPasswordWithToken({
        tokenHash: 'b'.repeat(64),
        contextHash: 'c'.repeat(64),
        passwordHash: 'new-password-hash',
        resetAt: timestamp,
        audit: {
          eventType: 'password_recovery.reset',
          userId,
          maskedEmail: 'us**@example.com',
          occurredAt: timestamp,
          ipAddress: '203.0.113.10',
          userAgent: 'jest',
        },
      }),
    ).resolves.toBe('reset');
    expect(query).toHaveBeenCalledTimes(6);
    expect(String(query.mock.calls[2]?.[0])).toContain('UPDATE password_reset_tokens');
    expect(String(query.mock.calls[3]?.[0])).toContain('UPDATE auth_sessions');
    expect(String(query.mock.calls[4]?.[0])).toContain('INSERT INTO audit_logs');
    expect(String(query.mock.calls[5]?.[0])).toContain('INSERT INTO audit_logs');
  });
});
