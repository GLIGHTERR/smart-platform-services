import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SignupChallengeSupersession1700000006000 implements MigrationInterface {
  public readonly name = 'SignupChallengeSupersession1700000006000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE outbox_events ADD COLUMN superseded_at timestamptz;
      CREATE INDEX idx_outbox_registration_unsuperseded
        ON outbox_events(next_attempt_at, created_at)
        WHERE event_type = 'registration_email' AND published_at IS NULL AND superseded_at IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_outbox_registration_unsuperseded;
      ALTER TABLE outbox_events DROP COLUMN IF EXISTS superseded_at;
    `);
  }
}
