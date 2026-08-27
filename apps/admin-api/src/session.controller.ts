import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  CurrentActor,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  type AuthenticatedActor,
} from '@platform/identity';

@Controller('session')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminSessionController {
  @Get('me')
  public me(@CurrentActor() actor: AuthenticatedActor): AuthenticatedActor {
    return actor;
  }
}
