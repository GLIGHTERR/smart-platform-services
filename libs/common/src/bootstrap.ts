import { ValidationPipe, type Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { ApiExceptionFilter } from './http/api-exception.filter';
import { HttpLoggingInterceptor } from './http/http-logging.interceptor';
import { requestIdMiddleware } from './http/request-id.middleware';
import { JsonLoggerService } from './logging/json-logger.service';

export interface ApiBootstrapOptions {
  appName: string;
  portConfigKey: 'app.ports.renter' | 'app.ports.owner' | 'app.ports.admin';
}

export async function bootstrapApi(
  rootModule: Type<unknown>,
  options: ApiBootstrapOptions,
): Promise<void> {
  const app = await NestFactory.create(rootModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  const logger = app.get(JsonLoggerService);

  app.useLogger(logger);
  app.use(helmet());
  app.use(requestIdMiddleware);
  app.enableCors({
    origin: config.getOrThrow<string[]>('app.corsOrigins'),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(app.get(ApiExceptionFilter));
  app.useGlobalInterceptors(app.get(HttpLoggingInterceptor));
  app.enableShutdownHooks();

  const port = config.getOrThrow<number>(options.portConfigKey);
  await app.listen(port, '0.0.0.0');
  logger.write('log', 'application_started', options.appName, { port });
}

export function handleBootstrapError(error: unknown): never {
  const normalized = error instanceof Error ? error : new Error(String(error));
  process.stderr.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'fatal',
      context: 'Bootstrap',
      message: normalized.message,
      stack: normalized.stack,
    })}\n`,
  );
  process.exit(1);
}
