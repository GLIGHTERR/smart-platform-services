import type { AuthenticatedActor } from '@platform/identity';
import { ProfileController } from './profile.controller';
import type { ProfileReadService } from './profile-read.service';
import type { ProfileUpdateService } from './profile-update.service';

describe('ProfileController', () => {
  it('uses only the authenticated actor id and exposes no client-selected subject argument', async () => {
    const read = jest.fn().mockResolvedValue({ profile: {}, rentals: [] });
    const update = jest.fn().mockResolvedValue({ profile: {} });
    const controller = new ProfileController(
      { read } as unknown as ProfileReadService,
      { update } as unknown as ProfileUpdateService,
    );
    const actor: AuthenticatedActor = {
      id: 'renter-a',
      roles: ['renter'],
      status: 'active',
      sessionId: 'session-a',
    };

    await expect(controller.read(actor)).resolves.toEqual({ profile: {}, rentals: [] });
    expect(read).toHaveBeenCalledWith('renter-a');
    expect(controller.read).toHaveLength(1);

    await expect(
      controller.update(actor, { displayName: 'Nguyen Van A', phone: null }),
    ).resolves.toEqual({ profile: {} });
    expect(update).toHaveBeenCalledWith('renter-a', { displayName: 'Nguyen Van A', phone: null });
    expect(controller.update).toHaveLength(2);
  });
});
