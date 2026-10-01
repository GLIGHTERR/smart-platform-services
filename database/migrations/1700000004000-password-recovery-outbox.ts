import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PasswordRecoveryOutbox1700000004000 implements MigrationInterface {
  public readonly name = 'PasswordRecoveryOutbox1700000004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE outbox_events
        ADD COLUMN locked_at timestamptz,
        ADD COLUMN lock_token uuid;
      CREATE INDEX idx_outbox_recovery_claim
        ON outbox_events(next_attempt_at, created_at)
        WHERE published_at IS NULL AND event_type = 'password_recovery_email';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_outbox_recovery_claim;
      ALTER TABLE outbox_events DROP COLUMN IF EXISTS lock_token, DROP COLUMN IF EXISTS locked_at;
    `);
  }
}
