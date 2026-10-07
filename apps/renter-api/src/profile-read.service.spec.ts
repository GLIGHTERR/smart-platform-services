import type { JsonLoggerService } from '@platform/common';
import type { ContractQueryService } from '@platform/contract';
import type { IdentityQueryService } from '@platform/identity';
import { ProfileReadService } from './profile-read.service';

describe('ProfileReadService', () => {
  function harness(): {
    identities: jest.Mocked<Pick<IdentityQueryService, 'getRenterProfile'>>;
    contracts: jest.Mocked<Pick<ContractQueryService, 'listActiveRentalsForRenter'>>;
    logger: jest.Mocked<Pick<JsonLoggerService, 'write'>>;
    service: ProfileReadService;
  } {
    const identities = { getRenterProfile: jest.fn() };
    const contracts = { listActiveRentalsForRenter: jest.fn() };
    const logger = { write: jest.fn() };
    return {
      identities,
      contracts,
      logger,
      service: new ProfileReadService(
        identities as unknown as IdentityQueryService,
        contracts as unknown as ContractQueryService,
        logger as unknown as JsonLoggerService,
      ),
    };
  }

  it('returns only the token subject profile, with the approved fields and avatar null', async () => {
    const { service, identities, contracts, logger } = harness();
    identities.getRenterProfile.mockResolvedValue({
      displayName: '  Mai Nguyen  ',
      email: ' mai@example.com ',
      phone: '+84901234567',
    });
    contracts.listActiveRentalsForRenter.mockResolvedValue([
      {
        contractId: 'contract-a',
        room: 'Phong 101',
        property: 'Nha tro A',
        propertyAddress: { street: '1 Nguyen Hue' },
        expiresAt: '2027-01-01',
        signedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    await expect(service.read('renter-a')).resolves.toEqual({
      profile: {
        displayName: 'Mai Nguyen',
        email: 'mai@example.com',
        phone: '+84901234567',
        avatar: null,
      },
      rentals: [
        {
          contractId: 'contract-a',
          room: 'Phong 101',
          property: 'Nha tro A',
          propertyAddress: { street: '1 Nguyen Hue' },
          expiresAt: '2027-01-01',
          signedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    expect(identities.getRenterProfile).toHaveBeenCalledWith('renter-a');
    expect(contracts.listActiveRentalsForRenter).toHaveBeenCalledWith('renter-a');
    expect(logger.write).not.toHaveBeenCalled();
  });

  it.each([null, '', '   '])(
    'rejects an authenticated renter with unusable email %p',
    async (email) => {
      const { service, identities, contracts } = harness();
      identities.getRenterProfile.mockResolvedValue({ displayName: 'Mai', email, phone: null });
      contracts.listActiveRentalsForRenter.mockResolvedValue([]);

      await expect(service.read('renter-a')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'PROFILE_INCOMPLETE' }),
      });
    },
  );

  it.each([null, '', '   '])(
    'uses the approved legacy display-name fallback for %p',
    async (displayName) => {
      const { service, identities, contracts } = harness();
      identities.getRenterProfile.mockResolvedValue({
        displayName,
        email: 'mai@example.com',
        phone: null,
      });
      contracts.listActiveRentalsForRenter.mockResolvedValue([]);

      await expect(service.read('renter-a')).resolves.toMatchObject({
        profile: { displayName: 'Người dùng SmartTrọ', email: 'mai@example.com', phone: null },
        rentals: [],
      });
    },
  );

  it.each([
    ['profile', new Error('database failure'), 'getRenterProfile'],
    ['contract', new Error('database failure'), 'listActiveRentalsForRenter'],
  ] as const)(
    'maps %s dependency failures to the generic unavailable contract',
    async (_name, error, method) => {
      const { service, identities, contracts, logger } = harness();
      identities.getRenterProfile.mockResolvedValue({
        displayName: 'Mai',
        email: 'mai@example.com',
        phone: null,
      });
      contracts.listActiveRentalsForRenter.mockResolvedValue([]);
      if (method === 'getRenterProfile') identities.getRenterProfile.mockRejectedValue(error);
      else contracts.listActiveRentalsForRenter.mockRejectedValue(error);

      await expect(service.read('renter-a')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'PROFILE_UNAVAILABLE' }),
      });
      expect(logger.write).toHaveBeenCalledWith(
        'warn',
        'profile_read_dependency_failure',
        'ProfileRead',
      );
    },
  );
});
