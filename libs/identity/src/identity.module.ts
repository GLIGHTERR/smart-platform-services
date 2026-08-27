import { Module } from '@nestjs/common';
import { AuthController } from './http/auth.controller';
import { IdentityRepository } from './persistence/identity.repository';
import { PostgresIdentityRepository } from './persistence/postgres-identity.repository';
import { ConfigurableOtpDeliveryService, OtpDeliveryPort } from './providers/otp-delivery.port';
import {
  SocialIdentityVerifier,
  UnconfiguredSocialIdentityVerifier,
} from './providers/social-identity-verifier.port';
import { IdentityAccessService, IdentityQueryService } from './public/identity.contracts';
import { JwtAuthGuard } from './security/jwt-auth.guard';
import { JwtSessionService } from './security/jwt-session.service';
import { PasswordHasherService } from './security/password-hasher.service';
import { RateLimiterService } from './security/rate-limiter.service';
import { RolesGuard } from './security/roles.guard';
import { AuthService } from './services/auth.service';
import {
  DefaultIdentityAccessService,
  DefaultIdentityQueryService,
} from './services/identity-query.service';

@Module({
  controllers: [AuthController],
  providers: [
    { provide: IdentityRepository, useClass: PostgresIdentityRepository },
    { provide: OtpDeliveryPort, useClass: ConfigurableOtpDeliveryService },
    { provide: SocialIdentityVerifier, useClass: UnconfiguredSocialIdentityVerifier },
    { provide: IdentityQueryService, useClass: DefaultIdentityQueryService },
    { provide: IdentityAccessService, useClass: DefaultIdentityAccessService },
    PasswordHasherService,
    RateLimiterService,
    JwtSessionService,
    JwtAuthGuard,
    RolesGuard,
    AuthService,
  ],
  exports: [IdentityQueryService, IdentityAccessService, JwtAuthGuard, RolesGuard],
})
export class IdentityModule {}
