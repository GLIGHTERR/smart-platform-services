import type { DataSource } from 'typeorm';
import type { EmailDeliveryPort } from '../../../libs/identity/src/providers/otp-delivery.port';
import { PasswordRecoveryOutboxService } from '../../../libs/identity/src/services/password-recovery-outbox.service';

describe('PasswordRecoveryOutboxService', () => {
  function createHarness(): {
    service: PasswordRecoveryOutboxService;
    query: jest.Mock;
    sendOtp: jest.Mock;
    logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock };
  } {
    const query = jest.fn();
    const sendOtp = jest.fn().mockResolvedValue(undefined);
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const service = new PasswordRecoveryOutboxService(
      { query } as unknown as DataSource,
      { sendOtp } as unknown as EmailDeliveryPort,
      {
        forChallenge: jest.fn().mockReturnValue('123456'),
        forRegistrationChallenge: jest.fn().mockReturnValue('654321'),
      } as never,
      logger as never,
    );
    return { service, query, sendOtp, logger };
  }

  it('claims, sends, and completes an eligible job without exposing its OTP in persistence calls', async () => {
    const { service, query, sendOtp } = createHarness();
    query
      .mockResolvedValueOnce([
        {
          id: 'job-1',
          aggregate_id: 'challenge-1',
          payload: { challengeId: 'challenge-1', email: 'user@example.com' },
          attempt_count: 0,
          created_at: new Date(),
        },
      ])
      .mockResolvedValueOnce([{ id: 'challenge-1', expires_at: new Date(Date.now() + 60_000) }])
      .mockResolvedValueOnce([]);

    await service.drain();

    expect(sendOtp).toHaveBeenCalledWith(expect.objectContaining({ code: '123456' }));
    expect(query.mock.calls.map(([sql]) => String(sql)).join('\n')).not.toContain('123456');
    expect(query.mock.calls[0]?.[0]).toContain('claimed AS');
    expect(query.mock.calls[0]?.[0]).toContain(
      'SELECT id, aggregate_id, event_type, payload, attempt_count, created_at FROM claimed',
    );
    expect(query.mock.calls.at(-1)?.[0]).toContain('published_at = now()');
  });

  it('quarantines a malformed job instead of crashing the API process', async () => {
    const { service, query, sendOtp } = createHarness();
    query
      .mockResolvedValueOnce([
        {
          id: 'job-invalid',
          aggregate_id: 'challenge-1',
          payload: undefined,
          attempt_count: 0,
          created_at: new Date(),
        },
      ])
      .mockResolvedValueOnce([]);

    await expect(service.drain()).resolves.toBeUndefined();

    expect(sendOtp).not.toHaveBeenCalled();
    expect(query.mock.calls.at(-1)?.[0]).toContain('published_at = now()');
    expect(query.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining(['invalid_payload']));
  });

  it('quarantines malformed object payloads and keeps a concurrent drain from claiming twice', async () => {
    const { service, query, sendOtp } = createHarness();
    query
      .mockResolvedValueOnce([
        {
          id: 'job-invalid-object',
          aggregate_id: 'challenge-1',
          payload: { challengeId: 1, email: 'user@example.com' },
          attempt_count: 0,
          created_at: new Date(),
        },
      ])
      .mockResolvedValueOnce([]);

    await service.drain();
    expect(sendOtp).not.toHaveBeenCalled();

    (service as unknown as { running: boolean }).running = true;
    await service.drain();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('marks a replaced or expired challenge as stale without sending', async () => {
    const { service, query, sendOtp } = createHarness();
    query
      .mockResolvedValueOnce([
        {
          id: 'job-1',
          aggregate_id: 'challenge-1',
          payload: { challengeId: 'challenge-1', email: 'user@example.com' },
          attempt_count: 0,
          created_at: new Date(),
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await service.drain();

    expect(sendOtp).not.toHaveBeenCalled();
    expect(query.mock.calls.at(-1)?.[0]).toContain('published_at = now()');
  });

  it('sends a registration OTP from the shared consumer and skips verified jobs', async () => {
    const { service, query, sendOtp } = createHarness();
    query
      .mockResolvedValueOnce([
        {
          id: 'job-registration',
          aggregate_id: 'challenge-registration',
          event_type: 'registration_email',
          payload: { challengeId: 'challenge-registration', email: 'user@example.com' },
          attempt_count: 0,
          created_at: new Date(),
        },
      ])
      .mockResolvedValueOnce([
        { id: 'challenge-registration', expires_at: new Date(Date.now() + 60_000) },
      ])
      .mockResolvedValueOnce([]);

    await service.drain();

    expect(sendOtp).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'registration', code: '654321' }),
    );
    expect(query.mock.calls[1]?.[0]).toContain('verified_at IS NULL');

    const stale = createHarness();
    stale.query
      .mockResolvedValueOnce([
        {
          id: 'job-verified',
          aggregate_id: 'challenge-verified',
          event_type: 'registration_email',
          payload: { challengeId: 'challenge-verified', email: 'user@example.com' },
          attempt_count: 0,
          created_at: new Date(),
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    await stale.service.drain();
    expect(stale.sendOtp).not.toHaveBeenCalled();
  });

  it('releases transient failures with bounded exponential backoff', async () => {
    const { service, query, sendOtp } = createHarness();
    sendOtp.mockRejectedValueOnce(new Error('provider unavailable'));
    query
      .mockResolvedValueOnce([
        {
          id: 'job-1',
          aggregate_id: 'challenge-1',
          payload: { challengeId: 'challenge-1', email: 'user@example.com' },
          attempt_count: 2,
          created_at: new Date(),
        },
      ])
      .mockResolvedValueOnce([{ id: 'challenge-1', expires_at: new Date(Date.now() + 60_000) }])
      .mockResolvedValueOnce([]);

    await service.drain();

    expect(query.mock.calls.at(-1)?.[0]).toContain('attempt_count = attempt_count + 1');
    expect(query.mock.calls.at(-1)?.[1]).toEqual(
      expect.arrayContaining([8, 'provider unavailable']),
    );
  });

  it('uses the fallback error message and guards lifecycle drain failures', async () => {
    const { service, query, sendOtp, logger } = createHarness();
    sendOtp.mockRejectedValueOnce('provider unavailable');
    query
      .mockResolvedValueOnce([
        {
          id: 'job-1',
          aggregate_id: 'challenge-1',
          payload: { challengeId: 'challenge-1', email: 'user@example.com' },
          attempt_count: 8,
          created_at: new Date(),
        },
      ])
      .mockResolvedValueOnce([{ id: 'challenge-1', expires_at: new Date(Date.now() + 60_000) }])
      .mockResolvedValueOnce([]);

    await service.drain();
    expect(query.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining([256, 'delivery failed']));

    jest.spyOn(service, 'drain').mockRejectedValueOnce(new Error('query unavailable'));
    await (
      service as unknown as { drainSafely(): Promise<void> }
    ).drainSafely();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'query unavailable' }),
      undefined,
      'PasswordRecoveryOutbox',
    );
  });

  it('starts and stops the shared consumer lifecycle', async () => {
    jest.useFakeTimers();
    const { service } = createHarness();
    const drain = jest.spyOn(service, 'drain').mockResolvedValue(undefined);

    service.onModuleInit();
    await Promise.resolve();
    jest.advanceTimersByTime(1_000);
    await Promise.resolve();
    service.onModuleDestroy();
    jest.advanceTimersByTime(1_000);

    expect(drain).toHaveBeenCalledTimes(2);
    createHarness().service.onModuleDestroy();
    jest.useRealTimers();
  });
});
