import { Controller, Module, UseGuards } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { IdentityModule } from './identity.module';
import { IdentityRepository } from './persistence/identity.repository';
import { JwtAuthGuard } from './security/jwt-auth.guard';
import { RolesGuard } from './security/roles.guard';

@Controller('external-session')
@UseGuards(JwtAuthGuard, RolesGuard)
class ExternalProtectedController {}

@Module({
  imports: [IdentityModule],
  controllers: [ExternalProtectedController],
})
class ExternalConsumerModule {}

describe('IdentityModule', () => {
  it('provides exported guards to controllers in an importing module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            (): Record<string, unknown> => ({
              app: { environment: 'test' },
              auth: {
                jwtAccessSecret: 'access-secret-for-module-boundary-test',
                jwtRefreshSecret: 'refresh-secret-for-module-boundary-test',
                jwtIssuer: 'module-boundary-test',
                accessTtlSeconds: 900,
                refreshTtlSeconds: 2_592_000,
                otpHashSecret: 'otp-secret-for-module-boundary-test',
                otpTtlSeconds: 600,
                otpMaxAttempts: 5,
                otpResendCooldownSeconds: 60,
                otpRequestLimitPerHour: 5,
                otpIpLimitPerHour: 20,
                otpDeviceLimitPerHour: 20,
                loginFailureLimit: 5,
                loginAbuseLimit: 20,
                loginWindowSeconds: 900,
                loginLockSeconds: 900,
                emailDeliveryMode: 'disabled',
                otpDeliveryMode: 'disabled',
                legacyPhoneFlowsEnabled: false,
              },
            }),
          ],
        }),
        ExternalConsumerModule,
      ],
    })
      .overrideProvider(IdentityRepository)
      .useValue({})
      .compile();

    expect(moduleRef.get(ExternalProtectedController)).toBeInstanceOf(
      ExternalProtectedController,
    );

    await moduleRef.close();
  });
});
