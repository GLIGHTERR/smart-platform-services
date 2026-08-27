import type { MigrationInterface, QueryRunner } from 'typeorm';

export class IdentityAuthSchema1700000001000 implements MigrationInterface {
  public readonly name = 'IdentityAuthSchema1700000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE social_identities (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider varchar(24) NOT NULL,
        provider_subject varchar(255) NOT NULL,
        provider_email varchar(320),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_social_identities_provider CHECK (provider IN ('google', 'facebook', 'apple')),
        CONSTRAINT uq_social_identities_subject UNIQUE (provider, provider_subject),
        CONSTRAINT uq_social_identities_user_provider UNIQUE (user_id, provider)
      );
      CREATE INDEX idx_social_identities_user ON social_identities(user_id);

      CREATE TABLE otp_challenges (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        phone varchar(32) NOT NULL,
        purpose varchar(32) NOT NULL,
        code_hash char(64) NOT NULL,
        attempt_count smallint NOT NULL DEFAULT 0,
        max_attempts smallint NOT NULL,
        expires_at timestamptz NOT NULL,
        consumed_at timestamptz,
        requested_ip inet,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_otp_challenges_purpose CHECK (purpose IN ('registration', 'login', 'password_reset')),
        CONSTRAINT chk_otp_challenges_attempts CHECK (attempt_count >= 0 AND max_attempts BETWEEN 1 AND 10)
      );
      CREATE UNIQUE INDEX uq_otp_challenges_active
        ON otp_challenges(phone, purpose)
        WHERE consumed_at IS NULL;
      CREATE INDEX idx_otp_challenges_expiry ON otp_challenges(expires_at) WHERE consumed_at IS NULL;

      CREATE TABLE auth_sessions (
        id uuid PRIMARY KEY,
        family_id uuid NOT NULL,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        refresh_token_hash char(64) NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL,
        last_used_at timestamptz,
        revoked_at timestamptz,
        revoke_reason varchar(64),
        replaced_by_session_id uuid REFERENCES auth_sessions(id) ON DELETE SET NULL,
        ip_address inet,
        user_agent varchar(500),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_auth_sessions_user_active
        ON auth_sessions(user_id, expires_at)
        WHERE revoked_at IS NULL;
      CREATE INDEX idx_auth_sessions_family ON auth_sessions(family_id);

      CREATE TABLE auth_throttle_buckets (
        scope varchar(64) NOT NULL,
        key_hash char(64) NOT NULL,
        window_started_at timestamptz NOT NULL,
        attempt_count integer NOT NULL DEFAULT 0,
        blocked_until timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (scope, key_hash),
        CONSTRAINT chk_auth_throttle_attempts CHECK (attempt_count >= 0)
      );
      CREATE INDEX idx_auth_throttle_cleanup ON auth_throttle_buckets(updated_at);

      CREATE TRIGGER trg_social_identities_updated_at
        BEFORE UPDATE ON social_identities
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();

      COMMENT ON TABLE social_identities IS 'identity module; verified provider identities only';
      COMMENT ON TABLE otp_challenges IS 'identity module; single-use hashed OTP challenges';
      COMMENT ON TABLE auth_sessions IS 'identity module; rotating refresh-token sessions';
      COMMENT ON TABLE auth_throttle_buckets IS 'identity module; persistent login and OTP throttles';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS auth_throttle_buckets;
      DROP TABLE IF EXISTS auth_sessions;
      DROP TABLE IF EXISTS otp_challenges;
      DROP TABLE IF EXISTS social_identities;
    `);
  }
}
