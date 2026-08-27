import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtSessionService } from './jwt-session.service';
import type { AuthenticatedRequest } from './auth-context';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  public constructor(private readonly sessions: JwtSessionService) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const [scheme, token, extra] = authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token || extra) {
      throw new UnauthorizedException({
        code: 'BEARER_TOKEN_REQUIRED',
        message: 'A valid Bearer access token is required',
      });
    }
    request.actor = await this.sessions.authenticateAccess(token);
    return true;
  }
}
