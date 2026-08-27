import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { configuration, validateEnvironment } from './config/environment';
import { DatabaseModule } from './database/database.module';
import { ApiExceptionFilter } from './http/api-exception.filter';
import { HttpLoggingInterceptor } from './http/http-logging.interceptor';
import { JsonLoggerService } from './logging/json-logger.service';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validate: validateEnvironment,
    }),
    DatabaseModule,
  ],
  providers: [JsonLoggerService, ApiExceptionFilter, HttpLoggingInterceptor],
  exports: [
    ConfigModule,
    DatabaseModule,
    JsonLoggerService,
    ApiExceptionFilter,
    HttpLoggingInterceptor,
  ],
})
export class PlatformCoreModule {}
