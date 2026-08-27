import type { ConfigService } from '@nestjs/config';
import { JsonLoggerService } from './json-logger.service';

describe('JsonLoggerService', () => {
  let stdout: jest.SpiedFunction<typeof process.stdout.write>;
  let stderr: jest.SpiedFunction<typeof process.stderr.write>;

  beforeEach(() => {
    stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
  });

  function createLogger(level: string): JsonLoggerService {
    const config = { get: jest.fn().mockReturnValue(level) } as unknown as ConfigService;
    return new JsonLoggerService(config);
  }

  it('writes every supported level as structured JSON', () => {
    const logger = createLogger('verbose');

    logger.log('started', 'Test');
    logger.warn('warning', 'Test');
    logger.debug({ bookingId: 'booking-1' }, 'Test');
    logger.verbose('trace', 'Test');
    logger.error('failed', 'stack-line', 'Test');
    logger.fatal(new Error('fatal'), 'Test');

    expect(stdout).toHaveBeenCalledTimes(4);
    expect(stderr).toHaveBeenCalledTimes(2);
    const firstRecord = JSON.parse(String(stdout.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(firstRecord).toEqual(
      expect.objectContaining({ level: 'log', context: 'Test', message: 'started' }),
    );
    expect(String(stderr.mock.calls[0]?.[0])).toContain('"stack":"stack-line"');
    expect(String(stderr.mock.calls[1]?.[0])).toContain('"name":"Error"');
  });

  it('suppresses messages below the configured level', () => {
    const logger = createLogger('error');

    logger.log('hidden');
    logger.warn('hidden');
    logger.error('visible');

    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledTimes(1);
  });
});
