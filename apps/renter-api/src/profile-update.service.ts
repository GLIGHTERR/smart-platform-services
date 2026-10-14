import {
  HttpException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JsonLoggerService } from '@platform/common';
import { IdentityProfileService } from '@platform/identity';

export interface RenterProfileUpdateResponse {
  profile: {
    displayName: string;
    email: string;
    phone: string | null;
    avatar: null;
  };
}

@Injectable()
export class ProfileUpdateService {
  public constructor(
    private readonly identities: IdentityProfileService,
    private readonly logger: JsonLoggerService,
  ) {}

  public async update(
    renterId: string,
    input: { displayName: string; phone: string | null },
  ): Promise<RenterProfileUpdateResponse> {
    try {
      const profile = await this.identities.updateRenterProfile(renterId, input);
      if (!profile || !profile.email?.trim()) {
        throw new UnauthorizedException({
          code: 'INVALID_SESSION',
          message: 'Session is invalid or expired',
        });
      }
      return {
        profile: {
          displayName: profile.displayName ?? input.displayName,
          email: profile.email.trim(),
          phone: profile.phone,
          avatar: null,
        },
      };
    } catch (error: unknown) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.write('warn', 'profile_update_dependency_failure', 'ProfileUpdate');
      throw new ServiceUnavailableException({
        code: 'PROFILE_UPDATE_UNAVAILABLE',
        message: 'Profile update is temporarily unavailable',
      });
    }
  }
}
