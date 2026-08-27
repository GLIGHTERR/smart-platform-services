import { Injectable, type LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type LogLevel = 'fatal' | 'error' | 'warn' | 'log' | 'debug' | 'verbose';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  fatal: 60,
  error: 50,
  warn: 40,
  log: 30,
  debug: 20,
  verbose: 10,
};

@Injectable()
export class JsonLoggerService implements LoggerService {
  private readonly minimumLevel: LogLevel;

  public constructor(config: ConfigService) {
    this.minimumLevel = config.get<LogLevel>('app.logLevel', 'log');
  }

  public log(message: unknown, context?: string): void {
    this.write('log', message, context);
  }

  public error(message: unknown, stack?: string, context?: string): void {
    this.write('error', message, context, stack ? { stack } : undefined);
  }

  public warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  public debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  public verbose(message: unknown, context?: string): void {
    this.write('verbose', message, context);
  }

  public fatal(message: unknown, context?: string): void {
    this.write('fatal', message, context);
  }

  public write(
    level: LogLevel,
    message: unknown,
    context?: string,
    metadata?: Record<string, unknown>,
  ): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.minimumLevel]) {
      return;
    }

    const record = {
      timestamp: new Date().toISOString(),
      level,
      context,
      message: this.normalizeMessage(message),
      ...metadata,
    };
    const output = `${JSON.stringify(record)}\n`;

    if (level === 'fatal' || level === 'error') {
      process.stderr.write(output);
      return;
    }
    process.stdout.write(output);
  }

  private normalizeMessage(message: unknown): unknown {
    if (message instanceof Error) {
      return { name: message.name, message: message.message, stack: message.stack };
    }
    return message;
  }
}
