import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import {
  CurrentActor,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  type AuthenticatedActor,
} from '@platform/identity';
import { ProfileReadService, type RenterProfileReadResponse } from './profile-read.service';

@Controller('profile')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('renter')
export class ProfileController {
  public constructor(private readonly profiles: ProfileReadService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  public read(@CurrentActor() actor: AuthenticatedActor): Promise<RenterProfileReadResponse> {
    return this.profiles.read(actor.id);
  }
}
