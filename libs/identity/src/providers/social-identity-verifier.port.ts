import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { SocialProvider } from '../public/identity.contracts';

export interface VerifiedSocialIdentity {
  subject: string;
  email: string | null;
  displayName: string | null;
}

export abstract class SocialIdentityVerifier {
  public abstract verify(
    provider: SocialProvider,
    credential: string,
  ): Promise<VerifiedSocialIdentity>;
}

@Injectable()
export class UnconfiguredSocialIdentityVerifier extends SocialIdentityVerifier {
  public verify(): Promise<VerifiedSocialIdentity> {
    throw new ServiceUnavailableException({
      code: 'SOCIAL_PROVIDER_UNAVAILABLE',
      message: 'Social login provider is not configured',
    });
  }
}
