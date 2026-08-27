export type ActorRole = 'renter' | 'owner' | 'admin';

export interface ActorSnapshot {
  id: string;
  roles: readonly ActorRole[];
  status: 'pending' | 'active' | 'suspended' | 'disabled';
}

export abstract class IdentityQueryService {
  public abstract getActorSnapshot(actorId: string): Promise<ActorSnapshot | null>;
  public abstract getActorsSnapshot(actorIds: readonly string[]): Promise<readonly ActorSnapshot[]>;
}

export abstract class IdentityAccessService {
  public abstract assertRenter(actorId: string): Promise<void>;
  public abstract assertOwner(actorId: string): Promise<void>;
  public abstract assertAdmin(actorId: string): Promise<void>;
  public abstract assertPermission(actorId: string, permission: string): Promise<void>;
  public abstract assertPayer(actorId: string): Promise<void>;
}
