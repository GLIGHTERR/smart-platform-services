import type { MigrationInterface, QueryRunner } from 'typeorm';

export class EmailIdentityAuth1700000002000 implements MigrationInterface {
  public readonly name = 'EmailIdentityAuth1700000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        ADD COLUMN phone_login_enabled boolean NOT NULL DEFAULT false,
        ALTER COLUMN display_name DROP NOT NULL;

      UPDATE users
      SET email = lower(btrim(email))
      WHERE email IS NOT NULL;

      UPDATE users
      SET phone_login_enabled = true
      WHERE email IS NULL AND phone IS NOT NULL;

      DROP INDEX uq_users_phone;
      CREATE UNIQUE INDEX uq_users_legacy_phone_login
        ON users(phone)
        WHERE phone IS NOT NULL AND phone_login_enabled AND deleted_at IS NULL;
      CREATE INDEX idx_users_phone_contact
        ON users(phone)
        WHERE phone IS NOT NULL AND deleted_at IS NULL;

      ALTER TABLE users
        ADD CONSTRAINT chk_users_email_normalized
          CHECK (email IS NULL OR email = lower(btrim(email)));

      ALTER TABLE otp_challenges
        ALTER COLUMN phone DROP NOT NULL,
        ADD COLUMN email varchar(320),
        ADD COLUMN verified_at timestamptz,
        ADD CONSTRAINT chk_otp_challenges_recipient
          CHECK ((email IS NOT NULL)::integer + (phone IS NOT NULL)::integer = 1),
        ADD CONSTRAINT chk_otp_challenges_email_normalized
          CHECK (email IS NULL OR email = lower(btrim(email)));

      CREATE UNIQUE INDEX uq_otp_challenges_active_email
        ON otp_challenges(email, purpose)
        WHERE email IS NOT NULL AND consumed_at IS NULL;
      CREATE INDEX idx_otp_challenges_email_created
        ON otp_challenges(email, purpose, created_at DESC)
        WHERE email IS NOT NULL;

      COMMENT ON COLUMN users.phone_login_enabled IS
        'Compatibility gate for legacy phone credentials; new email accounts keep phone as non-unique contact data';
      COMMENT ON COLUMN otp_challenges.email IS
        'Normalized email recipient for email OTP challenges';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM otp_challenges WHERE email IS NOT NULL;
      DROP INDEX IF EXISTS idx_otp_challenges_email_created;
      DROP INDEX IF EXISTS uq_otp_challenges_active_email;
      ALTER TABLE otp_challenges
        DROP CONSTRAINT IF EXISTS chk_otp_challenges_email_normalized,
        DROP CONSTRAINT IF EXISTS chk_otp_challenges_recipient,
        DROP COLUMN IF EXISTS verified_at,
        DROP COLUMN IF EXISTS email,
        ALTER COLUMN phone SET NOT NULL;

      DROP INDEX IF EXISTS idx_users_phone_contact;
      DROP INDEX IF EXISTS uq_users_legacy_phone_login;
      UPDATE users SET display_name = COALESCE(display_name, email, phone, 'User');
      ALTER TABLE users
        DROP CONSTRAINT IF EXISTS chk_users_email_normalized,
        DROP COLUMN IF EXISTS phone_login_enabled,
        ALTER COLUMN display_name SET NOT NULL;
      CREATE UNIQUE INDEX uq_users_phone
        ON users(phone)
        WHERE phone IS NOT NULL AND deleted_at IS NULL;
    `);
  }
}
