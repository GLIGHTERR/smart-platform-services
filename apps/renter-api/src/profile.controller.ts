import { Body, Controller, Get, Header, Patch, UseGuards } from '@nestjs/common';
import {
  CurrentActor,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  type AuthenticatedActor,
} from '@platform/identity';
import { ProfileReadService, type RenterProfileReadResponse } from './profile-read.service';
import { UpdateRenterProfileDto } from './profile-update.dto';
import { ProfileUpdateService, type RenterProfileUpdateResponse } from './profile-update.service';

@Controller('profile')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('renter')
export class ProfileController {
  public constructor(
    private readonly profiles: ProfileReadService,
    private readonly updates: ProfileUpdateService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  public read(@CurrentActor() actor: AuthenticatedActor): Promise<RenterProfileReadResponse> {
    return this.profiles.read(actor.id);
  }

  @Patch()
  @Header('Cache-Control', 'private, no-store')
  public update(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() input: UpdateRenterProfileDto,
  ): Promise<RenterProfileUpdateResponse> {
    return this.updates.update(actor.id, input);
  }
}
