import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import type { OwnerPropertyStatus, OwnerRoomStatus } from '../public/property.contracts';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreatePropertyDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(200) public name!: string;
  @Transform(trim) @IsOptional() @IsString() public description?: string | null;
  @IsObject() public address!: Record<string, unknown>;
}
export class UpdatePropertyDto {
  @Transform(trim) @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) public name?: string;
  @Transform(trim) @IsOptional() @IsString() public description?: string | null;
  @IsOptional() @IsObject() public address?: Record<string, unknown>;
}
export class CreateRoomDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(64) public code!: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(160) public name!: string;
  @Transform(trim) @IsOptional() @IsString() public description?: string | null;
  @IsNumberString() public monthlyRent!: string;
  @IsOptional() @IsNumberString() public depositAmount?: string;
  @Transform(trim) @IsOptional() @IsString() @Length(3, 3) public currency?: string;
}
export class UpdateRoomDto {
  @Transform(trim) @IsOptional() @IsString() @IsNotEmpty() @MaxLength(64) public code?: string;
  @Transform(trim) @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160) public name?: string;
  @Transform(trim) @IsOptional() @IsString() public description?: string | null;
  @IsOptional() @IsNumberString() public monthlyRent?: string;
  @IsOptional() @IsNumberString() public depositAmount?: string;
  @Transform(trim) @IsOptional() @IsString() @Length(3, 3) public currency?: string;
}
export class SetPropertyStatusDto {
  @IsIn(['draft', 'active', 'inactive']) public status!: OwnerPropertyStatus;
}
export class SetRoomStatusDto {
  @IsIn(['available', 'maintenance', 'inactive']) public status!: OwnerRoomStatus;
}
