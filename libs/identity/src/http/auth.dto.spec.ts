import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  LoginDto,
  PasswordRecoveryResetDto,
  PasswordRecoveryVerifyDto,
  SignupCompleteDto,
  SignupOtpRequestDto,
  SignupOtpVerifyDto,
} from './auth.dto';

describe('email auth DTOs', () => {
  it('normalizes valid email inputs without changing passwords', async () => {
    const login = plainToInstance(LoginDto, {
      email: '  User@Example.COM ',
      password: '  Secure1!  ',
    });

    await expect(validate(login)).resolves.toHaveLength(0);
    expect(login).toEqual({ email: 'user@example.com', password: '  Secure1!  ' });
  });

  it('rejects malformed signup email and OTP input', async () => {
    const request = plainToInstance(SignupOtpRequestDto, { email: 'not-an-email' });
    const verification = plainToInstance(SignupOtpVerifyDto, {
      email: 'user@example.com',
      attemptId: 'not-a-uuid',
      code: '12a',
    });

    expect(await validate(request)).toHaveLength(1);
    expect(await validate(verification)).toHaveLength(2);
  });

  it.each([
    ['short', 'Aa1!'],
    ['lowercase', 'PASSWORD1!'],
    ['uppercase', 'password1!'],
    ['number', 'Password!'],
    ['special', 'Password1'],
  ])('rejects a password missing the %s rule', async (_rule, password) => {
    const input = plainToInstance(SignupCompleteDto, {
      email: 'user@example.com',
      attemptId: '234cc3de-18ca-4b8b-a45d-522b9ec5d31e',
      code: '123456',
      password,
    });

    expect(await validate(input)).not.toHaveLength(0);
  });

  it('accepts optional E.164 contact phone and rejects a non-E.164 value', async () => {
    const valid = plainToInstance(SignupCompleteDto, {
      email: 'user@example.com',
      attemptId: '234cc3de-18ca-4b8b-a45d-522b9ec5d31e',
      code: '123456',
      password: 'Secure1!',
      phone: ' +84901234567 ',
    });
    const invalid = plainToInstance(SignupCompleteDto, {
      ...valid,
      phone: '0901234567',
    });

    await expect(validate(valid)).resolves.toHaveLength(0);
    expect(valid.phone).toBe('+84901234567');
    expect(await validate(invalid)).toHaveLength(1);
  });

  it('validates recovery challenge, reset token, password policy, and confirmation payload shape', async () => {
    const verification = plainToInstance(PasswordRecoveryVerifyDto, {
      email: ' USER@example.com ',
      challengeId: '234cc3de-18ca-4b8b-a45d-522b9ec5d31e',
      code: '123456',
    });
    const reset = plainToInstance(PasswordRecoveryResetDto, {
      resetToken: 'a'.repeat(43),
      newPassword: 'Changed1!',
      confirmPassword: 'Changed1!',
    });
    await expect(validate(verification)).resolves.toHaveLength(0);
    expect(verification.email).toBe('user@example.com');
    await expect(validate(reset)).resolves.toHaveLength(0);

    const invalid = plainToInstance(PasswordRecoveryResetDto, {
      resetToken: 'short',
      newPassword: 'password',
      confirmPassword: '',
    });
    expect(await validate(invalid)).not.toHaveLength(0);
  });
});
