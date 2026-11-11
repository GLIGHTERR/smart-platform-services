import { plainToInstance } from 'class-transformer';
import { ValidationPipe } from '@nestjs/common';
import { validate } from 'class-validator';
import {
  LoginDto,
  ChangePasswordDto,
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
      displayName: 'Nguyen Van A',
    });

    expect(await validate(input)).not.toHaveLength(0);
  });

  it('accepts optional E.164 contact phone and rejects a non-E.164 value', async () => {
    const valid = plainToInstance(SignupCompleteDto, {
      email: 'user@example.com',
      attemptId: '234cc3de-18ca-4b8b-a45d-522b9ec5d31e',
      code: '123456',
      password: 'Secure1!',
      displayName: '  Nguyen   Van A  ',
      phone: ' +84901234567 ',
    });
    const invalid = plainToInstance(SignupCompleteDto, {
      ...valid,
      phone: '0901234567',
    });

    await expect(validate(valid)).resolves.toHaveLength(0);
    expect(valid.displayName).toBe('Nguyen Van A');
    expect(valid.phone).toBe('+84901234567');
    expect(await validate(invalid)).toHaveLength(1);
  });

  it.each([undefined, null, '   '])(
    'rejects an absent or blank display name: %p',
    async (displayName) => {
      const input = plainToInstance(SignupCompleteDto, {
        email: 'user@example.com',
        attemptId: '234cc3de-18ca-4b8b-a45d-522b9ec5d31e',
        code: '123456',
        password: 'Secure1!',
        displayName,
      });

      expect(await validate(input)).not.toHaveLength(0);
    },
  );

  it.each([undefined, null, '   '])(
    'maps an omitted, null, or blank phone to no contact value: %p',
    async (phone) => {
      const input = plainToInstance(SignupCompleteDto, {
        email: 'user@example.com',
        attemptId: '234cc3de-18ca-4b8b-a45d-522b9ec5d31e',
        code: '123456',
        password: 'Secure1!',
        displayName: 'Nguyen Van A',
        phone,
      });

      await expect(validate(input)).resolves.toHaveLength(0);
      expect(input.phone ?? null).toBeNull();
    },
  );

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

  it('requires the D01 special-character rule for a password change', async () => {
    const valid = plainToInstance(ChangePasswordDto, {
      currentPassword: 'Current1!',
      confirmPassword: 'Changed1!',
      newPassword: 'Changed1!',
    });
    const invalid = plainToInstance(ChangePasswordDto, {
      currentPassword: 'Current1!',
      confirmPassword: 'Changed1!',
      newPassword: 'Changed12',
    });
    await expect(validate(valid)).resolves.toHaveLength(0);
    expect(await validate(invalid)).not.toHaveLength(0);
  });

  it('accepts canonical confirmation through the production whitelist and rejects missing/invalid input', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    const metadata = { type: 'body' as const, metatype: ChangePasswordDto };
    const body = {
      currentPassword: 'Current1!',
      newPassword: 'Changed1!',
      confirmPassword: 'Changed1!',
    };
    await expect(pipe.transform(body, metadata)).resolves.toEqual(body);
    for (const confirmPassword of [undefined, null, '', 123, 'a'.repeat(129)]) {
      await expect(pipe.transform({ ...body, confirmPassword }, metadata)).rejects.toBeDefined();
    }
    await expect(
      pipe.transform({ ...body, userId: 'another-subject' }, metadata),
    ).rejects.toBeDefined();
  });

  it.each(['Aa1!aaaa', `Aa1!${'x'.repeat(124)}`, ' Aa1!aaa '])(
    'accepts D01 boundaries without transforming password characters',
    async (password) => {
      const input = plainToInstance(ChangePasswordDto, {
        currentPassword: ' Current1! ',
        newPassword: password,
        confirmPassword: password,
      });
      expect(await validate(input)).toHaveLength(0);
      expect(input.newPassword).toBe(password);
      expect(input.confirmPassword).toBe(password);
      expect(input.currentPassword).toBe(' Current1! ');
    },
  );

  it.each([
    'Aa1!aaa',
    `Aa1!${'x'.repeat(125)}`,
    'PASSWORD1!',
    'password1!',
    'Password!',
    'Password1',
    '',
    null,
    123,
  ])('rejects invalid D01 input %p', async (password) => {
    const input = plainToInstance(ChangePasswordDto, {
      currentPassword: 'Current1!',
      newPassword: password,
      confirmPassword: password,
    });
    expect(await validate(input)).not.toHaveLength(0);
  });
});
