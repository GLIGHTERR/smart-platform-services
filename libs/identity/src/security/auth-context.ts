import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { ActorRole, AuthenticatedActor } from '../public/identity.contracts';

export const REQUIRED_ROLES_KEY = 'identity.required_roles';

export const Roles = (...roles: readonly ActorRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_ROLES_KEY, roles);

export interface AuthenticatedRequest extends Request {
  actor?: AuthenticatedActor;
}

export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedActor => {
    const actor = context.switchToHttp().getRequest<AuthenticatedRequest>().actor;
    if (!actor) {
      throw new Error('CurrentActor used without JwtAuthGuard');
    }
    return actor;
  },
);
