import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ContractActiveLifecycle1700000005000 implements MigrationInterface {
  public readonly name = 'ContractActiveLifecycle1700000005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contracts
        ADD CONSTRAINT chk_contracts_active_lifecycle
        CHECK (
          status <> 'active'
          OR (
            owner_signed_at IS NOT NULL
            AND renter_signed_at IS NOT NULL
            AND activated_at IS NOT NULL
            AND ends_on IS NOT NULL
          )
        ) NOT VALID;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contracts
        DROP CONSTRAINT IF EXISTS chk_contracts_active_lifecycle;
    `);
  }
}
