import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PasswordChange1700000007000 implements MigrationInterface {
  public readonly name = 'PasswordChange1700000007000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE password_change_idempotency (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key_hash char(64) NOT NULL,
        outcome varchar(16) NOT NULL,
        completed_at timestamptz NOT NULL,
        PRIMARY KEY (user_id, key_hash),
        CONSTRAINT chk_password_change_idempotency_outcome CHECK (outcome = 'changed')
      );
      COMMENT ON TABLE password_change_idempotency IS
        'identity module; hashed idempotency keys and authoritative password-change outcomes';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS password_change_idempotency;`);
  }
}
