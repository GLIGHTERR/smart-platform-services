import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Response } from 'express';

@Injectable()
export class PrivateNoStoreGuard implements CanActivate {
  public canActivate(context: ExecutionContext): boolean {
    // Route headers run after authentication; set this before any guard can reject.
    context.switchToHttp().getResponse<Response>().setHeader('Cache-Control', 'private, no-store');
    return true;
  }
}
