import type { DataSource } from 'typeorm';
import type { EmailDeliveryPort } from '../../../libs/identity/src/providers/otp-delivery.port';
import { PasswordRecoveryOutboxService } from './password-recovery-outbox.service';

describe('PasswordRecoveryOutboxService', () => {
  function createHarness(): { service: PasswordRecoveryOutboxService; query: jest.Mock; sendOtp: jest.Mock } {
    const query = jest.fn();
    const sendOtp = jest.fn().mockResolvedValue(undefined);
    const service = new PasswordRecoveryOutboxService(
      { query } as unknown as DataSource,
      { sendOtp } as unknown as EmailDeliveryPort,
      { forChallenge: jest.fn().mockReturnValue('123456') } as never,
      { log: jest.fn(), warn: jest.fn() } as never,
    );
    return { service, query, sendOtp };
  }

  it('claims, sends, and completes an eligible job without exposing its OTP in persistence calls', async () => {
    const { service, query, sendOtp } = createHarness();
    query
      .mockResolvedValueOnce([
        { id: 'job-1', aggregate_id: 'challenge-1', payload: { challengeId: 'challenge-1', email: 'user@example.com' }, attempt_count: 0, created_at: new Date() },
      ])
      .mockResolvedValueOnce([{ id: 'challenge-1', expires_at: new Date(Date.now() + 60_000) }])
      .mockResolvedValueOnce([]);

    await service.drain();

    expect(sendOtp).toHaveBeenCalledWith(expect.objectContaining({ code: '123456' }));
    expect(query.mock.calls.map(([sql]) => String(sql)).join('\n')).not.toContain('123456');
    expect(query.mock.calls.at(-1)?.[0]).toContain('published_at = now()');
  });

  it('marks a replaced or expired challenge as stale without sending', async () => {
    const { service, query, sendOtp } = createHarness();
    query.mockResolvedValueOnce([
      { id: 'job-1', aggregate_id: 'challenge-1', payload: { challengeId: 'challenge-1', email: 'user@example.com' }, attempt_count: 0, created_at: new Date() },
    ]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await service.drain();

    expect(sendOtp).not.toHaveBeenCalled();
    expect(query.mock.calls.at(-1)?.[0]).toContain('published_at = now()');
  });

  it('releases transient failures with bounded exponential backoff', async () => {
    const { service, query, sendOtp } = createHarness();
    sendOtp.mockRejectedValueOnce(new Error('provider unavailable'));
    query
      .mockResolvedValueOnce([
        { id: 'job-1', aggregate_id: 'challenge-1', payload: { challengeId: 'challenge-1', email: 'user@example.com' }, attempt_count: 2, created_at: new Date() },
      ])
      .mockResolvedValueOnce([{ id: 'challenge-1', expires_at: new Date(Date.now() + 60_000) }])
      .mockResolvedValueOnce([]);

    await service.drain();

    expect(query.mock.calls.at(-1)?.[0]).toContain('attempt_count = attempt_count + 1');
    expect(query.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining([8, 'provider unavailable']));
  });
});
