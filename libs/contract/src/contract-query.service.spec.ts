import type { JsonLoggerService } from '@platform/common';
import type { ActiveRenterContractRecord, ContractRepository } from './contract.repository';
import { DefaultContractQueryService } from './contract-query.service';

describe('DefaultContractQueryService', () => {
  function harness(records: readonly ActiveRenterContractRecord[] = []): {
    repository: jest.Mocked<Pick<ContractRepository, 'listActiveRenterContracts'>>;
    logger: jest.Mocked<Pick<JsonLoggerService, 'write'>>;
    service: DefaultContractQueryService;
  } {
    const repository = { listActiveRenterContracts: jest.fn().mockResolvedValue(records) };
    const logger = { write: jest.fn() };
    return {
      repository,
      logger,
      service: new DefaultContractQueryService(
        repository as unknown as ContractRepository,
        logger as unknown as JsonLoggerService,
      ),
    };
  }

  it('returns zero rentals when the contract store has no active contracts', async () => {
    const { service, logger } = harness();

    await expect(service.listActiveRentalsForRenter('renter-a')).resolves.toEqual([]);
    expect(logger.write).not.toHaveBeenCalled();
  });

  it('uses renter_signed_at first, activated_at only as legacy fallback, and sorts stably', async () => {
    const { service, repository } = harness();
    repository.listActiveRenterContracts.mockResolvedValue([
      {
        contractId: 'b',
        room: 'Phong 2',
        property: 'Nha B',
        expiresAt: null,
        renterSignedAt: null,
        activatedAt: new Date('2026-02-01T00:00:00.000Z'),
      },
      {
        contractId: 'a',
        room: 'Phong 1',
        property: 'Nha A',
        expiresAt: '2027-01-01',
        renterSignedAt: new Date('2026-01-01T00:00:00.000Z'),
        activatedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
      {
        contractId: 'c',
        room: 'Phong 3',
        property: 'Nha C',
        expiresAt: '2027-02-01',
        renterSignedAt: new Date('2026-01-01T00:00:00.000Z'),
        activatedAt: null,
      },
    ]);

    await expect(service.listActiveRentalsForRenter('renter-a')).resolves.toEqual([
      expect.objectContaining({ contractId: 'a', signedAt: '2026-01-01T00:00:00.000Z' }),
      expect.objectContaining({ contractId: 'c', signedAt: '2026-01-01T00:00:00.000Z' }),
      expect.objectContaining({ contractId: 'b', signedAt: '2026-02-01T00:00:00.000Z' }),
    ]);
  });

  it('omits malformed timestamps and emits a count-only data-quality signal', async () => {
    const { service, repository, logger } = harness();
    repository.listActiveRenterContracts.mockResolvedValue([
      {
        contractId: 'broken',
        room: 'Phong 1',
        property: 'Nha A',
        expiresAt: '2027-01-01',
        renterSignedAt: null,
        activatedAt: null,
      },
    ]);

    await expect(service.listActiveRentalsForRenter('renter-a')).resolves.toEqual([]);
    expect(logger.write).toHaveBeenCalledWith(
      'warn',
      'profile_active_rental_missing_signed_at',
      'ContractQuery',
      { count: 1 },
    );
  });

  it.each([
    { room: null, property: 'Nha A' },
    { room: 'Phong 1', property: null },
  ])(
    'fails closed when an active contract cannot build a rental card',
    async ({ room, property }) => {
      const { service, repository, logger } = harness();
      repository.listActiveRenterContracts.mockResolvedValue([
        {
          contractId: 'broken',
          room,
          property,
          expiresAt: '2027-01-01',
          renterSignedAt: new Date('2026-01-01T00:00:00.000Z'),
          activatedAt: null,
        },
      ]);

      await expect(service.listActiveRentalsForRenter('renter-a')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'PROFILE_UNAVAILABLE' }),
      });
      expect(logger.write).toHaveBeenCalledWith(
        'warn',
        'profile_active_rental_relation_missing',
        'ContractQuery',
        { count: 1 },
      );
    },
  );
});
