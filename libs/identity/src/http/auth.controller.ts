import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedActor } from '../public/identity.contracts';
import { CurrentActor } from '../security/auth-context';
import { JwtAuthGuard } from '../security/jwt-auth.guard';
import type { SessionClientContext } from '../security/jwt-session.service';
import { AuthService } from '../services/auth.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  OtpRequestDto,
  OtpVerifyDto,
  PasswordRecoveryRequestDto,
  PasswordRecoveryResetDto,
  PasswordRecoveryVerifyDto,
  RefreshTokenDto,
  RegisterDto,
  ResetPasswordDto,
  SignupCompleteDto,
  SignupOtpRequestDto,
  SignupOtpVerifyDto,
  SocialLoginDto,
} from './auth.dto';

@Controller('auth')
export class AuthController {
  public constructor(private readonly auth: AuthService) {}

  @Post('signup/otp/request')
  @HttpCode(HttpStatus.ACCEPTED)
  public requestSignupOtp(
    @Body() input: SignupOtpRequestDto,
    @Req() request: Request,
  ): ReturnType<AuthService['requestSignupOtp']> {
    return this.auth.requestSignupOtp(input.email, this.context(request));
  }

  @Post('signup/otp/verify')
  @HttpCode(HttpStatus.OK)
  public verifySignupOtp(
    @Body() input: SignupOtpVerifyDto,
    @Req() request: Request,
  ): ReturnType<AuthService['verifySignupOtp']> {
    return this.auth.verifySignupOtp(input, this.context(request));
  }

  @Post('signup/complete')
  @HttpCode(HttpStatus.CREATED)
  public completeSignup(
    @Body() input: SignupCompleteDto,
  ): ReturnType<AuthService['completeSignup']> {
    return this.auth.completeSignup(input);
  }

  @Post('register')
  public register(
    @Body() input: RegisterDto,
    @Req() request: Request,
  ): ReturnType<AuthService['register']> {
    return this.auth.register(input, this.context(request));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  public login(@Body() input: LoginDto, @Req() request: Request): ReturnType<AuthService['login']> {
    return this.auth.login(input, this.context(request));
  }

  @Post('password/recovery/request')
  @HttpCode(HttpStatus.ACCEPTED)
  public requestPasswordRecovery(
    @Body() input: PasswordRecoveryRequestDto,
    @Req() request: Request,
  ): ReturnType<AuthService['requestPasswordRecovery']> {
    return this.auth.requestPasswordRecovery(input.email, this.context(request));
  }

  @Post('password/recovery/verify')
  @HttpCode(HttpStatus.OK)
  public verifyPasswordRecovery(
    @Body() input: PasswordRecoveryVerifyDto,
    @Req() request: Request,
  ): ReturnType<AuthService['verifyPasswordRecovery']> {
    return this.auth.verifyPasswordRecovery(input, this.context(request));
  }

  @Post('password/recovery/reset')
  @HttpCode(HttpStatus.OK)
  public completePasswordRecovery(
    @Body() input: PasswordRecoveryResetDto,
    @Req() request: Request,
  ): ReturnType<AuthService['completePasswordRecovery']> {
    return this.auth.completePasswordRecovery(input, this.context(request));
  }

  @Post('otp/request')
  @HttpCode(HttpStatus.ACCEPTED)
  public requestOtp(
    @Body() input: OtpRequestDto,
    @Req() request: Request,
  ): ReturnType<AuthService['requestOtp']> {
    return this.auth.requestOtp(input.phone, input.purpose, this.context(request));
  }

  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  public verifyOtp(
    @Body() input: OtpVerifyDto,
    @Req() request: Request,
  ): ReturnType<AuthService['verifyOtp']> {
    return this.auth.verifyOtp(input.phone, input.purpose, input.code, this.context(request));
  }

  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  public forgotPassword(
    @Body() input: ForgotPasswordDto,
    @Req() request: Request,
  ): ReturnType<AuthService['forgotPassword']> {
    return this.auth.forgotPassword(input.phone, this.context(request));
  }

  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  public resetPassword(
    @Body() input: ResetPasswordDto,
    @Req() request: Request,
  ): ReturnType<AuthService['resetPassword']> {
    return this.auth.resetPassword(input, this.context(request));
  }

  @Post('password/change')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  public changePassword(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() input: ChangePasswordDto,
    @Req() request: Request,
  ): ReturnType<AuthService['changePassword']> {
    return this.auth.changePassword(actor, input, this.context(request));
  }

  @Post('token/refresh')
  @HttpCode(HttpStatus.OK)
  public refresh(
    @Body() input: RefreshTokenDto,
    @Req() request: Request,
  ): ReturnType<AuthService['refresh']> {
    return this.auth.refresh(input.refreshToken, this.context(request));
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async logout(@Body() input: RefreshTokenDto): Promise<void> {
    await this.auth.logout(input.refreshToken);
  }

  @Post('logout/all')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  public async logoutAll(@CurrentActor() actor: AuthenticatedActor): Promise<void> {
    await this.auth.logoutAll(actor);
  }

  @Post('oauth/:provider')
  @HttpCode(HttpStatus.OK)
  public socialLogin(
    @Param('provider') provider: string,
    @Body() input: SocialLoginDto,
    @Req() request: Request,
  ): ReturnType<AuthService['socialLogin']> {
    return this.auth.socialLogin(provider, input, this.context(request));
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  public me(@CurrentActor() actor: AuthenticatedActor): AuthenticatedActor {
    return actor;
  }

  private context(request: Request): SessionClientContext {
    return {
      ipAddress: request.ip || null,
      userAgent: request.get('user-agent') ?? null,
      deviceId: request.get('x-device-id') ?? null,
    };
  }
}
