import type { DataSource } from 'typeorm';
import { PostgresIdentityRepository } from './postgres-identity.repository';

describe('PostgresIdentityRepository OTP mutations', () => {
  const challengeId = '891124c5-c5e4-4c1e-b268-b28644046570';
  const timestamp = new Date('2026-09-21T10:00:00.000Z');

  function repositoryWithResult(result: unknown): {
    repository: PostgresIdentityRepository;
    query: jest.Mock;
  } {
    const query = jest.fn().mockResolvedValue(result);
    const dataSource = { query } as unknown as DataSource;
    return { repository: new PostgresIdentityRepository(dataSource), query };
  }

  it.each([
    ['verification', 'markOtpVerified'],
    ['consumption', 'consumeOtp'],
  ] as const)('accepts the PostgreSQL UPDATE result shape for OTP %s', async (_name, method) => {
    const { repository } = repositoryWithResult([[{ id: challengeId }], 1]);

    await expect(repository[method](challengeId, timestamp)).resolves.toBe(true);
  });

  it.each([
    ['verification', 'markOtpVerified'],
    ['consumption', 'consumeOtp'],
  ] as const)('rejects an OTP %s update that affected no rows', async (_name, method) => {
    const { repository } = repositoryWithResult([[], 0]);

    await expect(repository[method](challengeId, timestamp)).resolves.toBe(false);
  });

  it('keeps compatibility with a plain returned-row array', async () => {
    const { repository } = repositoryWithResult([{ id: challengeId }]);

    await expect(repository.markOtpVerified(challengeId, timestamp)).resolves.toBe(true);
  });
});
