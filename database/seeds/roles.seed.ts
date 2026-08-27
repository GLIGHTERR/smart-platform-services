import type { DataSource } from 'typeorm';
import dataSource from '../data-source';

export const BASE_ROLES = [
  { code: 'renter', name: 'Renter', description: 'Renter mobile application user' },
  { code: 'owner', name: 'Owner', description: 'Property owner application user' },
  { code: 'admin', name: 'Administrator', description: 'Platform administration user' },
] as const;

export async function seedRoles(source: DataSource = dataSource): Promise<void> {
  const ownsConnection = !source.isInitialized;
  if (ownsConnection) {
    await source.initialize();
  }

  try {
    await source.transaction(async (manager) => {
      for (const role of BASE_ROLES) {
        await manager.query(
          `
            INSERT INTO roles (code, name, description)
            VALUES ($1, $2, $3)
            ON CONFLICT (code)
            DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
          `,
          [role.code, role.name, role.description],
        );
      }
    });
  } finally {
    if (ownsConnection && source.isInitialized) {
      await source.destroy();
    }
  }
}

async function main(): Promise<void> {
  await seedRoles();
  process.stdout.write('Base roles seeded successfully.\n');
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
