import {
  ConflictException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JsonLoggerService } from '@platform/common';
import { ContractQueryService, type ActiveRentalSummary } from '@platform/contract';
import { IdentityQueryService } from '@platform/identity';

export interface RenterProfileReadResponse {
  profile: {
    displayName: string;
    email: string;
    phone: string | null;
    avatar: null;
  };
  rentals: readonly ActiveRentalSummary[];
}

@Injectable()
export class ProfileReadService {
  public constructor(
    private readonly identities: IdentityQueryService,
    private readonly contracts: ContractQueryService,
    private readonly logger: JsonLoggerService,
  ) {}

  public async read(renterId: string): Promise<RenterProfileReadResponse> {
    try {
      const [identity, rentals] = await Promise.all([
        this.identities.getRenterProfile(renterId),
        this.contracts.listActiveRentalsForRenter(renterId),
      ]);
      const email = identity?.email?.trim();
      if (!identity || !email) {
        throw new ConflictException({
          code: 'PROFILE_INCOMPLETE',
          message: 'Profile is incomplete',
        });
      }
      return {
        profile: {
          displayName: identity.displayName?.trim() || 'Người dùng SmartTrọ',
          email,
          phone: identity.phone,
          avatar: null,
        },
        rentals,
      };
    } catch (error: unknown) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.write('warn', 'profile_read_dependency_failure', 'ProfileRead');
      throw new ServiceUnavailableException({
        code: 'PROFILE_UNAVAILABLE',
        message: 'Profile is temporarily unavailable',
      });
    }
  }
}
