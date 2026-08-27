import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule, type TypeOrmModuleOptions } from '@nestjs/typeorm';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService): TypeOrmModuleOptions => {
        const sslEnabled = config.get<boolean>('database.ssl', false);

        return {
          type: 'postgres',
          host: config.getOrThrow<string>('database.host'),
          port: config.getOrThrow<number>('database.port'),
          database: config.getOrThrow<string>('database.name'),
          username: config.getOrThrow<string>('database.user'),
          password: config.getOrThrow<string>('database.password'),
          ssl: sslEnabled
            ? {
                rejectUnauthorized: config.get<boolean>('database.sslRejectUnauthorized', true),
              }
            : false,
          synchronize: false,
          autoLoadEntities: false,
          migrationsRun: false,
          retryAttempts: 5,
          retryDelay: 2_000,
          logging: ['error'],
          extra: {
            max: config.get<number>('database.poolSize', 10),
            application_name: 'smart-platform-services',
          },
        };
      },
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
