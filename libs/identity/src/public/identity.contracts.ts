export type ActorRole = 'renter' | 'owner' | 'admin';
export type ActorStatus = 'pending' | 'active' | 'suspended' | 'disabled';
export type SocialProvider = 'google' | 'facebook' | 'apple';

export interface ActorSnapshot {
  id: string;
  roles: readonly ActorRole[];
  status: ActorStatus;
}

export interface AuthenticatedActor extends ActorSnapshot {
  sessionId: string;
}

export interface AuthSessionTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  accessExpiresInSeconds: number;
  refreshExpiresInSeconds: number;
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
