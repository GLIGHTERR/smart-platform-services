import { Transform } from 'class-transformer';
import { IsDefined, IsNotEmpty, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

const E164_PHONE = /^\+[1-9]\d{7,14}$/;

function collapsedName(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : value;
}

function nullablePhone(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? null : value;
}

export class UpdateRenterProfileDto {
  @Transform(({ value }): unknown => collapsedName(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  public displayName!: string;

  @Transform(({ value }): unknown => nullablePhone(value))
  @IsDefined()
  @ValidateIf((_object, value) => value !== null)
  @Matches(E164_PHONE, {
    message: 'phone must use E.164 format, for example +84901234567',
  })
  public phone!: string | null;
}
