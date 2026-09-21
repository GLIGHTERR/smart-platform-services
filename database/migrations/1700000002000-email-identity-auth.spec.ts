import type { QueryRunner } from 'typeorm';
import { EmailIdentityAuth1700000002000 } from './1700000002000-email-identity-auth';

describe('EmailIdentityAuth1700000002000', () => {
  it('adds email OTP state without modifying the merged GLI-11 migration', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new EmailIdentityAuth1700000002000();

    await migration.up({ query } as unknown as QueryRunner);

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain('ADD COLUMN phone_login_enabled');
    expect(sql).toContain('ALTER COLUMN display_name DROP NOT NULL');
    expect(sql).toContain('ADD COLUMN email varchar(320)');
    expect(sql).toContain('uq_otp_challenges_active_email');
    expect(sql).toContain('uq_users_legacy_phone_login');
  });

  it('defines a rollback for every added constraint, column, and index', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new EmailIdentityAuth1700000002000();

    await migration.down({ query } as unknown as QueryRunner);

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain('DROP INDEX IF EXISTS uq_otp_challenges_active_email');
    expect(sql).toContain('DROP COLUMN IF EXISTS verified_at');
    expect(sql).toContain('DROP COLUMN IF EXISTS phone_login_enabled');
    expect(sql).toContain('CREATE UNIQUE INDEX uq_users_phone');
  });
});
