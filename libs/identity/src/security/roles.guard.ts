import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_ROLES_KEY, type AuthenticatedRequest } from './auth-context';
import type { ActorRole } from '../public/identity.contracts';

@Injectable()
export class RolesGuard implements CanActivate {
  public constructor(private readonly reflector: Reflector) {}

  public canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<readonly ActorRole[]>(REQUIRED_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }
    const actor = context.switchToHttp().getRequest<AuthenticatedRequest>().actor;
    if (!actor || !required.some((role) => actor.roles.includes(role))) {
      throw new ForbiddenException({
        code: 'ROLE_FORBIDDEN',
        message: 'This account role cannot access the requested resource',
      });
    }
    return true;
  }
}
