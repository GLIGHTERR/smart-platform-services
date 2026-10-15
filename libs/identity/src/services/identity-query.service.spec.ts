import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { InMemoryIdentityRepository } from '../../../../test/support/in-memory-identity.repository';
import { PasswordHasherService } from '../security/password-hasher.service';
import {
  DefaultIdentityAccessService,
  DefaultIdentityProfileService,
  DefaultIdentityQueryService,
} from './identity-query.service';

describe('identity query and access contracts', () => {
  async function harness(): Promise<{
    repository: InMemoryIdentityRepository;
    queries: DefaultIdentityQueryService;
    profiles: DefaultIdentityProfileService;
    access: DefaultIdentityAccessService;
    renterId: string;
  }> {
    const repository = new InMemoryIdentityRepository();
    const passwordHash = await new PasswordHasherService().hash('Secure123');
    const renter = repository.addActiveUser({ phone: '+84901234567', passwordHash });
    const queries = new DefaultIdentityQueryService(repository);
    return {
      repository,
      queries,
      profiles: new DefaultIdentityProfileService(repository),
      access: new DefaultIdentityAccessService(queries),
      renterId: renter.id,
    };
  }

  it('returns immutable actor snapshots and filters missing actors in batch reads', async () => {
    const { queries, repository, renterId } = await harness();

    await expect(queries.getActorSnapshot(renterId)).resolves.toEqual({
      id: renterId,
      roles: ['renter'],
      status: 'active',
    });
    await expect(queries.getActorsSnapshot([renterId, 'missing'])).resolves.toHaveLength(1);
    await expect(queries.getRenterProfile(renterId)).resolves.toEqual({
      email: null,
      phone: '+84901234567',
      displayName: 'Existing User',
    });
    const owner = repository.addActiveUser({
      phone: '+84909999999',
      passwordHash: 'hash',
      roles: ['owner'],
    });
    await expect(queries.getRenterProfile(owner.id)).resolves.toBeNull();
    await expect(queries.getRenterProfile('missing')).resolves.toBeNull();
  });

  it('enforces active role, permission and payer checks through the public contract', async () => {
    const { repository, access, renterId } = await harness();

    await expect(access.assertRenter(renterId)).resolves.toBeUndefined();
    await expect(access.assertPayer(renterId)).resolves.toBeUndefined();
    await expect(access.assertOwner(renterId)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(access.assertPermission(renterId, 'renter:book')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(access.assertPermission(renterId, 'unknown:write')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(access.assertAdmin('missing')).rejects.toBeInstanceOf(NotFoundException);

    const renter = repository.users.get(renterId);
    if (renter) {
      repository.users.set(renterId, { ...renter, status: 'disabled' });
    }
    await expect(access.assertRenter(renterId)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('updates only the active renter profile through the public identity contract', async () => {
    const { profiles, repository, renterId } = await harness();

    await expect(
      profiles.updateRenterProfile(renterId, {
        displayName: 'Nguyen Van A',
        phone: null,
      }),
    ).resolves.toEqual({ email: null, displayName: 'Nguyen Van A', phone: null });

    const owner = repository.addActiveUser({
      phone: '+84909999999',
      passwordHash: 'hash',
      roles: ['owner'],
    });
    await expect(
      profiles.updateRenterProfile(owner.id, { displayName: 'Owner', phone: null }),
    ).resolves.toBeNull();
  });

  it('keeps an active renter profile readable before and after its subject-scoped update', async () => {
    const { profiles, queries, renterId } = await harness();

    await expect(queries.getRenterProfile(renterId)).resolves.toMatchObject({
      displayName: 'Existing User',
    });
    await expect(
      profiles.updateRenterProfile(renterId, {
        displayName: 'Nguyen Van A',
        phone: null,
      }),
    ).resolves.toEqual({ email: null, displayName: 'Nguyen Van A', phone: null });
    await expect(queries.getRenterProfile(renterId)).resolves.toEqual({
      email: null,
      displayName: 'Nguyen Van A',
      phone: null,
    });
  });
});
