import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthenticatedActor } from '../public/identity.contracts';
import type { AuthenticatedRequest } from './auth-context';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { JwtSessionService } from './jwt-session.service';
import { RolesGuard } from './roles.guard';

describe('identity HTTP guards', () => {
  function contextFor(request: Partial<AuthenticatedRequest>): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => request as Request }),
      getHandler: () => contextFor,
      getClass: () => JwtAuthGuard,
    } as unknown as ExecutionContext;
  }

  it('accepts a protected request with a valid Bearer access token and attaches the actor', async () => {
    const actor: AuthenticatedActor = {
      id: 'user-1',
      roles: ['renter'],
      status: 'active',
      sessionId: 'session-1',
    };
    const sessions = {
      authenticateAccess: jest.fn().mockResolvedValue(actor),
    } as unknown as JwtSessionService;
    const request: Partial<AuthenticatedRequest> = {
      headers: { authorization: 'Bearer valid-access-token' },
    };

    await expect(new JwtAuthGuard(sessions).canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.actor).toEqual(actor);
  });

  it('rejects protected requests without a Bearer token', async () => {
    const sessions = { authenticateAccess: jest.fn() } as unknown as JwtSessionService;

    await expect(
      new JwtAuthGuard(sessions).canActivate(contextFor({ headers: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an authenticated actor with the wrong application role', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['owner']),
    } as unknown as Reflector;
    const context = contextFor({
      actor: { id: 'user-1', roles: ['renter'], status: 'active', sessionId: 'session-1' },
    });

    expect(() => new RolesGuard(reflector).canActivate(context)).toThrow(ForbiddenException);
  });
});
