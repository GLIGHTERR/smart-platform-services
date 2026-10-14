import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateRenterProfileDto } from './profile-update.dto';

describe('UpdateRenterProfileDto', () => {
  it('normalizes Unicode names and a blank phone to the canonical update payload', async () => {
    const input = plainToInstance(UpdateRenterProfileDto, {
      displayName: '  Nguyen   Van   A  ',
      phone: '   ',
    });

    await expect(validate(input)).resolves.toHaveLength(0);
    expect(input).toEqual({ displayName: 'Nguyen Van A', phone: null });
  });

  it.each([
    [null, '+84901234567'],
    ['', '+84901234567'],
    ['   ', '+84901234567'],
    ['a'.repeat(161), '+84901234567'],
    ['Nguyen Van A', undefined],
    ['Nguyen Van A', '0901234567'],
    ['Nguyen Van A', '+8490123'],
    ['Nguyen Van A', '+8490123456789012'],
  ])('rejects invalid profile input', async (displayName, phone) => {
    const input = plainToInstance(UpdateRenterProfileDto, { displayName, phone });

    expect(await validate(input)).not.toHaveLength(0);
  });

  it.each(['A', 'Nguyen Van A', 'a'.repeat(160)])(
    'accepts name boundary %p with canonical phone',
    async (displayName) => {
      const input = plainToInstance(UpdateRenterProfileDto, {
        displayName,
        phone: '+84901234567',
      });

      await expect(validate(input)).resolves.toHaveLength(0);
    },
  );
});
