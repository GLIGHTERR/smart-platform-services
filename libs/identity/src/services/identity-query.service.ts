import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { IdentityRepository } from '../persistence/identity.repository';
import {
  IdentityAccessService,
  IdentityQueryService,
  type ActorRole,
  type ActorSnapshot,
} from '../public/identity.contracts';

@Injectable()
export class DefaultIdentityQueryService extends IdentityQueryService {
  public constructor(private readonly repository: IdentityRepository) {
    super();
  }

  public async getActorSnapshot(actorId: string): Promise<ActorSnapshot | null> {
    const user = await this.repository.findById(actorId);
    return user ? { id: user.id, roles: user.roles, status: user.status } : null;
  }

  public async getActorsSnapshot(actorIds: readonly string[]): Promise<readonly ActorSnapshot[]> {
    const snapshots = await Promise.all(actorIds.map((actorId) => this.getActorSnapshot(actorId)));
    return snapshots.filter((snapshot): snapshot is ActorSnapshot => snapshot !== null);
  }
}

@Injectable()
export class DefaultIdentityAccessService extends IdentityAccessService {
  public constructor(private readonly queries: IdentityQueryService) {
    super();
  }

  public assertRenter(actorId: string): Promise<void> {
    return this.assertRole(actorId, 'renter');
  }

  public assertOwner(actorId: string): Promise<void> {
    return this.assertRole(actorId, 'owner');
  }

  public assertAdmin(actorId: string): Promise<void> {
    return this.assertRole(actorId, 'admin');
  }

  public async assertPermission(actorId: string, permission: string): Promise<void> {
    await this.requireActive(actorId);
    throw new ForbiddenException({
      code: 'PERMISSION_POLICY_UNDEFINED',
      message: `No granular permission policy is defined for ${permission}`,
    });
  }

  public async assertPayer(actorId: string): Promise<void> {
    const actor = await this.requireActive(actorId);
    if (!actor.roles.includes('renter') && !actor.roles.includes('owner')) {
      throw this.roleForbidden();
    }
  }

  private async assertRole(actorId: string, role: ActorRole): Promise<void> {
    const actor = await this.requireActive(actorId);
    if (!actor.roles.includes(role)) {
      throw this.roleForbidden();
    }
  }

  private async requireActive(actorId: string): Promise<ActorSnapshot> {
    const actor = await this.queries.getActorSnapshot(actorId);
    if (!actor) {
      throw new NotFoundException({ code: 'ACTOR_NOT_FOUND', message: 'Actor was not found' });
    }
    if (actor.status !== 'active') {
      throw new ForbiddenException({ code: 'ACTOR_INACTIVE', message: 'Actor is not active' });
    }
    return actor;
  }

  private roleForbidden(): ForbiddenException {
    return new ForbiddenException({
      code: 'ROLE_FORBIDDEN',
      message: 'Actor does not have the required role',
    });
  }
}
