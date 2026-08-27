import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { handleBootstrapError, JsonLoggerService } from '@platform/common';
import { WorkerModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(JsonLoggerService));
  app.enableShutdownHooks();
}

void bootstrap().catch(handleBootstrapError);
