import type { JsonLoggerService } from '@platform/common';
import type { IdentityProfileService } from '@platform/identity';
import { ProfileUpdateService } from './profile-update.service';

describe('ProfileUpdateService', () => {
  function harness(): {
    identities: jest.Mocked<Pick<IdentityProfileService, 'updateRenterProfile'>>;
    logger: jest.Mocked<Pick<JsonLoggerService, 'write'>>;
    service: ProfileUpdateService;
  } {
    const identities = { updateRenterProfile: jest.fn() };
    const logger = { write: jest.fn() };
    return {
      identities,
      logger,
      service: new ProfileUpdateService(
        identities as unknown as IdentityProfileService,
        logger as unknown as JsonLoggerService,
      ),
    };
  }

  it('updates only the token subject and returns the authoritative profile', async () => {
    const { service, identities, logger } = harness();
    identities.updateRenterProfile.mockResolvedValue({
      displayName: 'Nguyen Van A',
      email: ' renter@example.com ',
      phone: '+84901234567',
    });

    await expect(
      service.update('renter-a', { displayName: 'Nguyen Van A', phone: '+84901234567' }),
    ).resolves.toEqual({
      profile: {
        displayName: 'Nguyen Van A',
        email: 'renter@example.com',
        phone: '+84901234567',
        avatar: null,
      },
    });
    expect(identities.updateRenterProfile).toHaveBeenCalledWith('renter-a', {
      displayName: 'Nguyen Van A',
      phone: '+84901234567',
    });
    expect(logger.write).not.toHaveBeenCalled();
  });

  it('uses the normalized request name only if a legacy profile row has no display name', async () => {
    const { service, identities } = harness();
    identities.updateRenterProfile.mockResolvedValue({
      displayName: null,
      email: 'renter@example.com',
      phone: null,
    });

    await expect(
      service.update('renter-a', { displayName: 'Nguyen Van A', phone: null }),
    ).resolves.toMatchObject({ profile: { displayName: 'Nguyen Van A', phone: null } });
  });

  it.each([null, { displayName: 'Nguyen Van A', email: null, phone: null }])(
    'maps a missing update subject or usable email to the common invalid-session response',
    async (profile) => {
      const { service, identities, logger } = harness();
      identities.updateRenterProfile.mockResolvedValue(profile);

      await expect(
        service.update('renter-a', { displayName: 'Nguyen Van A', phone: null }),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'INVALID_SESSION' }) });
      expect(logger.write).not.toHaveBeenCalled();
    },
  );

  it('maps repository failures to a safe retryable response without logging profile data', async () => {
    const { service, identities, logger } = harness();
    identities.updateRenterProfile.mockRejectedValue(new Error('database failure'));

    await expect(
      service.update('renter-a', { displayName: 'Nguyen Van A', phone: null }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PROFILE_UPDATE_UNAVAILABLE' }),
    });
    expect(logger.write).toHaveBeenCalledWith(
      'warn',
      'profile_update_dependency_failure',
      'ProfileUpdate',
    );
  });
});
