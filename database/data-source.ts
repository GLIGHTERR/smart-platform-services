import 'reflect-metadata';
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { platformMigrations } from './migrations';

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const sslEnabled = process.env.DATABASE_SSL === 'true';

const dataSource = new DataSource({
  type: 'postgres',
  host: requiredEnvironment('DATABASE_HOST'),
  port: Number(process.env.DATABASE_PORT ?? 5432),
  database: requiredEnvironment('DATABASE_NAME'),
  username: requiredEnvironment('DATABASE_USER'),
  password: requiredEnvironment('DATABASE_PASSWORD'),
  ssl: sslEnabled
    ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : false,
  synchronize: false,
  logging: ['error'],
  migrationsTableName: 'platform_migrations',
  migrationsTransactionMode: 'all',
  migrations: platformMigrations,
});

export default dataSource;
