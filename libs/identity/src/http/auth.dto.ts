import { Transform } from 'class-transformer';
import {
  IsIn,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { OtpPurpose } from '../persistence/identity.repository';
import type { ActorRole } from '../public/identity.contracts';

const E164_PHONE = /^\+[1-9]\d{7,14}$/;
const OTP_CODE = /^\d{6}$/;

function trimmed(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function normalizedEmail(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

class EmailDto {
  @Transform(({ value }): unknown => normalizedEmail(value))
  @IsEmail()
  @MaxLength(320)
  public email!: string;
}

class PasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/[a-z]/, { message: 'password must contain a lowercase letter' })
  @Matches(/[A-Z]/, { message: 'password must contain an uppercase letter' })
  @Matches(/\d/, { message: 'password must contain a number' })
  @Matches(/[^A-Za-z0-9]/, { message: 'password must contain a special character' })
  public password!: string;
}

export class SignupOtpRequestDto extends EmailDto {}

export class SignupOtpVerifyDto extends EmailDto {
  @IsUUID()
  public attemptId!: string;

  @Matches(OTP_CODE)
  public code!: string;
}

export class SignupCompleteDto extends PasswordDto {
  @Transform(({ value }): unknown => normalizedEmail(value))
  @IsEmail()
  @MaxLength(320)
  public email!: string;

  @IsUUID()
  public attemptId!: string;

  @Matches(OTP_CODE)
  public code!: string;

  @IsOptional()
  @Transform(({ value }): unknown => trimmed(value))
  @Matches(E164_PHONE, { message: 'phone must use E.164 format, for example +84901234567' })
  public phone?: string;
}

export class RegisterDto {
  @Transform(({ value }): unknown => trimmed(value))
  @Matches(E164_PHONE, { message: 'phone must use E.164 format, for example +84901234567' })
  public phone!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/[a-z]/, { message: 'password must contain a lowercase letter' })
  @Matches(/[A-Z]/, { message: 'password must contain an uppercase letter' })
  @Matches(/\d/, { message: 'password must contain a number' })
  public password!: string;

  @Transform(({ value }): unknown => trimmed(value))
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  public displayName!: string;

  @IsIn(['renter', 'owner'])
  public role!: Exclude<ActorRole, 'admin'>;
}

export class LoginDto {
  @Transform(({ value }): unknown => normalizedEmail(value))
  @IsEmail()
  @MaxLength(320)
  public email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  public password!: string;
}

export class OtpRequestDto {
  @Transform(({ value }): unknown => trimmed(value))
  @Matches(E164_PHONE)
  public phone!: string;

  @IsIn(['registration', 'login'])
  public purpose!: Exclude<OtpPurpose, 'password_reset'>;
}

export class OtpVerifyDto extends OtpRequestDto {
  @Matches(OTP_CODE)
  public code!: string;
}

export class ForgotPasswordDto {
  @Transform(({ value }): unknown => trimmed(value))
  @Matches(E164_PHONE)
  public phone!: string;
}

export class ResetPasswordDto extends ForgotPasswordDto {
  @Matches(OTP_CODE)
  public code!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/[a-z]/)
  @Matches(/[A-Z]/)
  @Matches(/\d/)
  public newPassword!: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  public currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/[a-z]/)
  @Matches(/[A-Z]/)
  @Matches(/\d/)
  public newPassword!: string;
}

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  public refreshToken!: string;
}

export class SocialLoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(8192)
  public credential!: string;

  @IsOptional()
  @IsIn(['renter', 'owner'])
  public role?: Exclude<ActorRole, 'admin'>;
}
