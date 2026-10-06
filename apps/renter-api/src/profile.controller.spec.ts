import type { AuthenticatedActor } from '@platform/identity';
import { ProfileController } from './profile.controller';
import type { ProfileReadService } from './profile-read.service';

describe('ProfileController', () => {
  it('uses only the authenticated actor id and exposes no client-selected subject argument', async () => {
    const read = jest.fn().mockResolvedValue({ profile: {}, rentals: [] });
    const controller = new ProfileController({ read } as unknown as ProfileReadService);
    const actor: AuthenticatedActor = {
      id: 'renter-a',
      roles: ['renter'],
      status: 'active',
      sessionId: 'session-a',
    };

    await expect(controller.read(actor)).resolves.toEqual({ profile: {}, rentals: [] });
    expect(read).toHaveBeenCalledWith('renter-a');
    expect(controller.read).toHaveLength(1);
  });
});
