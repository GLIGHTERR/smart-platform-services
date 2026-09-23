import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PasswordRecovery1700000003000 implements MigrationInterface {
  public readonly name = 'PasswordRecovery1700000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE password_reset_tokens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        challenge_id uuid NOT NULL REFERENCES otp_challenges(id) ON DELETE CASCADE,
        token_hash char(64) NOT NULL,
        context_hash char(64) NOT NULL,
        expires_at timestamptz NOT NULL,
        consumed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_password_reset_tokens_challenge UNIQUE (challenge_id),
        CONSTRAINT uq_password_reset_tokens_hash UNIQUE (token_hash)
      );
      CREATE INDEX idx_password_reset_tokens_active_user
        ON password_reset_tokens(user_id, expires_at)
        WHERE consumed_at IS NULL;
      CREATE INDEX idx_password_reset_tokens_cleanup
        ON password_reset_tokens(expires_at, consumed_at);

      COMMENT ON TABLE password_reset_tokens IS
        'identity module; hashed, context-bound, single-use password recovery tokens';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS password_reset_tokens;`);
  }
}
